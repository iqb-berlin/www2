#!/usr/bin/env python3
"""Extract ordinary Zope Files from a legacy ZEXP without importing/unpickling code.

Usage: python3 scripts/extract-zope-export.py archive.zexp output-directory
The output directory must not exist. Metadata goes in a sibling .migration/<name>.report.json.
Only a restricted data-only pickle opcode subset is interpreted; other opcodes
fail closed. GLOBAL/OBJ/BUILD are represented as inert data, never executed.
"""
import argparse
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import pickletools
import struct


@dataclass(frozen=True)
class Global:
    name: str


@dataclass(frozen=True)
class Ref:
    oid: bytes


MARK = object()


def decode_record(data):
    memo, values = {}, []
    offset = 0
    while offset < len(data):
        stack = []
        def marked():
            index = len(stack) - 1
            while index >= 0 and stack[index] is not MARK:
                index -= 1
            if index < 0:
                raise ValueError('Missing pickle MARK')
            result = stack[index + 1:]
            del stack[index:]
            return result
        for op, arg, pos in pickletools.genops(data[offset:]):
            name = op.name
            if name in ('PROTO', 'FRAME'):
                continue
            if name == 'MARK': stack.append(MARK)
            elif name == 'GLOBAL': stack.append(Global(arg))
            elif name in ('SHORT_BINSTRING', 'BINSTRING', 'STRING'):
                stack.append(arg.encode('latin1'))
            elif name in ('BINBYTES', 'SHORT_BINBYTES', 'BINBYTES8', 'BYTEARRAY8'):
                stack.append(bytes(arg))
            elif name in ('BINUNICODE', 'SHORT_BINUNICODE', 'BINUNICODE8', 'UNICODE',
                          'INT', 'BININT', 'BININT1', 'BININT2', 'LONG', 'LONG1', 'LONG4', 'FLOAT', 'BINFLOAT'):
                stack.append(arg)
            elif name == 'NONE': stack.append(None)
            elif name in ('NEWTRUE', 'NEWFALSE'): stack.append(name == 'NEWTRUE')
            elif name == 'EMPTY_DICT': stack.append({})
            elif name == 'EMPTY_LIST': stack.append([])
            elif name == 'EMPTY_TUPLE': stack.append(())
            elif name == 'TUPLE': stack.append(tuple(marked()))
            elif name == 'LIST': stack.append(marked())
            elif name in ('TUPLE1', 'TUPLE2', 'TUPLE3'):
                n = int(name[-1]); items = stack[-n:]; del stack[-n:]; stack.append(tuple(items))
            elif name in ('BINPUT', 'LONG_BINPUT', 'PUT'): memo[int(arg)] = stack[-1]
            elif name == 'MEMOIZE': memo[len(memo)] = stack[-1]
            elif name in ('BINGET', 'LONG_BINGET', 'GET'): stack.append(memo[int(arg)])
            elif name == 'BINPERSID':
                pid = stack.pop()
                oid = pid[0] if isinstance(pid, tuple) else pid
                if not isinstance(oid, bytes) or len(oid) != 8:
                    raise ValueError('Unsupported persistent reference')
                stack.append(Ref(oid))
            elif name == 'APPEND':
                value = stack.pop(); stack[-1].append(value)
            elif name == 'APPENDS':
                items = marked(); stack[-1].extend(items)
            elif name == 'SETITEM':
                value = stack.pop(); key = stack.pop(); stack[-1][key] = value
            elif name in ('SETITEMS', 'DICT'):
                items = marked()
                if len(items) % 2: raise ValueError('Odd dictionary item count')
                pairs = dict(zip(items[::2], items[1::2]))
                if name == 'DICT': stack.append(pairs)
                else: stack[-1].update(pairs)
            elif name == 'OBJ':
                items = marked(); stack.append({'inert_class': items[0], 'inert_args': items[1:]})
            elif name == 'BUILD':
                state = stack.pop(); stack[-1]['inert_state'] = state
            elif name == 'STOP':
                if len(stack) != 1: raise ValueError('Unexpected pickle stack')
                values.append(stack[0]); offset += pos + 1
                break
            else:
                raise ValueError(f'Unsupported pickle opcode: {name}')
        else:
            raise ValueError('Missing pickle STOP')
    if values and isinstance(values[0], tuple) and len(values[0]) == 2 and values[0][1] == ():
        values[0] = values[0][0]
    if len(values) != 2 or not isinstance(values[0], Global) or not isinstance(values[1], dict):
        raise ValueError(f'Expected Zope class and state records: {[type(v).__name__ for v in values]}, class={values[0]!r}')
    return values[0].name, values[1]


def read_export(source):
    records = {}
    with source.open('rb') as stream:
        if stream.read(4) != b'ZEXP': raise ValueError('Not a ZEXP archive')
        while True:
            header = stream.read(16)
            if header == b'\xff' * 16:
                if stream.read(1): raise ValueError('Unsupported trailing archive data')
                break
            if len(header) != 16: raise ValueError('Truncated ZEXP header')
            oid, length = header[:8], struct.unpack('>Q', header[8:])[0]
            if length > 512 * 1024 * 1024: raise ValueError('Record exceeds 512 MiB limit')
            data = stream.read(length)
            if len(data) != length: raise ValueError('Truncated ZEXP record')
            if oid in records: raise ValueError('Duplicate object identifier')
            records[oid] = decode_record(data)
    if not records: raise ValueError('Empty export')
    return records


def text(value):
    if isinstance(value, bytes):
        try: return value.decode('utf-8')
        except UnicodeDecodeError: return value.decode('latin1')
    return str(value)


def file_data(value, records):
    parts, seen = [], set()
    while isinstance(value, Ref):
        if value.oid in seen: raise ValueError('Cyclic Pdata chain')
        seen.add(value.oid)
        cls, state = records[value.oid]
        if cls != 'OFS.Image Pdata': raise ValueError(f'Unexpected file payload class {cls}')
        chunk = state[b'data']
        if not isinstance(chunk, bytes): raise ValueError('Nonbinary Pdata chunk')
        parts.append(chunk)
        value = state.get(b'next')
    if value is not None:
        if not isinstance(value, bytes): raise ValueError('Nonbinary file data')
        parts.append(value)
    return b''.join(parts)


def extract(source, output):
    records = read_export(source)
    files, preserved, folders, visited = [], [], [], set()
    def walk(oid, relative):
        if oid in visited: raise ValueError('Duplicate/cyclic folder reference')
        visited.add(oid)
        cls, state = records[oid]
        if cls == 'OFS.Folder Folder':
            folders.append(relative)
            for obj in state.get(b'_objects', ()):
                name = obj[b'id']; filename = text(name)
                if not filename or filename in ('.', '..') or any(c in filename for c in '/\\\0'):
                    raise ValueError(f'Unsafe object name: {filename!r}')
                child = state[name]
                if not isinstance(child, Ref): raise ValueError('Non-reference folder child')
                walk(child.oid, relative / filename)
        elif cls in ('OFS.Image File', 'OFS.Image Image'):
            data = file_data(state.get(b'data'), records)
            if b'size' in state and len(data) != state[b'size']:
                raise ValueError(f'File size mismatch: {relative}')
            files.append((relative, data))
        else:
            entry = {'path': str(relative), 'class': cls}
            for key in (b'_text', b'_body', b'content_de', b'title'):
                if isinstance(state.get(key), (bytes, str)): entry[text(key)] = text(state[key])
            preserved.append(entry)
    walk(next(iter(records)), Path('.'))
    report = {'source': source.name, 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
              'records': len(records), 'directories': len(folders), 'files': [], 'zopeObjects': preserved}
    report_path = output.parent / '.migration' / (output.name + '.report.json')
    if report_path.exists(): raise FileExistsError(report_path)
    # Parse and validate the whole archive before creating output; never overwrite.
    output.mkdir(parents=True, exist_ok=False)
    for folder in folders: (output / folder).mkdir(parents=True, exist_ok=True)
    for relative, data in files:
        with (output / relative).open('xb') as stream: stream.write(data)
        report['files'].append({'path': str(relative), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    report_path.parent.mkdir(exist_ok=True)
    with report_path.open('x') as stream: json.dump(report, stream, indent=2, ensure_ascii=False)
    print(json.dumps({'output': str(output), 'report': str(report_path), 'records': len(records),
                      'files': len(files), 'bytes': sum(len(data) for _, data in files),
                      'zopeObjects': len(preserved)}, indent=2))
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    extract(args.archive, args.output)
