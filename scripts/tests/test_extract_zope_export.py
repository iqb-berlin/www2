import importlib.util
import io
from pathlib import Path
import pickle
import struct
import sys
import tempfile
import unittest
from contextlib import redirect_stdout

spec = importlib.util.spec_from_file_location('zope_export', Path(__file__).resolve().parents[1] / 'extract-zope-export.py')
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


def record(oid, cls, state):
    buf = io.BytesIO()
    class Writer(pickle.Pickler):
        def persistent_id(self, obj):
            return obj.oid if isinstance(obj, module.Ref) else None
    Writer(buf, protocol=3).dump(state)
    payload = b'c' + cls.replace(' ', '\n').encode() + b'\n.' + buf.getvalue()
    return oid + struct.pack('>Q', len(payload)) + payload


class ExportTests(unittest.TestCase):
    def test_binary_extraction_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            archive = base / 'test.zexp'
            root, file, chunk = [bytes([i]) * 8 for i in (1, 2, 3)]
            payload = bytes(range(256))
            archive.write_bytes(b'ZEXP' + record(root, 'OFS.Folder Folder', {
                b'_objects': ({b'id': b'file.exe'},), b'file.exe': module.Ref(file)
            }) + record(file, 'OFS.Image File', {b'data': module.Ref(chunk), b'size': len(payload)})
                + record(chunk, 'OFS.Image Pdata', {b'data': payload}) + b'\xff' * 16)
            with redirect_stdout(io.StringIO()): module.extract(archive, base / 'out')
            self.assertEqual((base / 'out/file.exe').read_bytes(), payload)
            self.assertTrue((base / '.migration/out.report.json').exists())
            with self.assertRaises(FileExistsError): module.extract(archive, base / 'out')

    def test_refuses_code_execution_opcode(self):
        with self.assertRaisesRegex(ValueError, 'Unsupported pickle opcode: REDUCE'):
            module.decode_record(b"cos\nsystem\n(S'echo must-not-execute'\ntR.")

    def test_memo_is_shared_between_class_and_state(self):
        cls, state = module.decode_record(b'cOFS.Folder\nFolder\nq\x01.}q\x02U\x01xq\x03h\x01s.')
        self.assertEqual(cls, 'OFS.Folder Folder')
        self.assertEqual(state[b'x'], module.Global(cls))

    def test_rejects_folder_traversal_before_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            archive = base / 'test.zexp'
            archive.write_bytes(b'ZEXP' + record(b'1'*8, 'OFS.Folder Folder', {
                b'_objects': ({b'id': b'../outside'},), b'../outside': module.Ref(b'2'*8)
            }) + b'\xff'*16)
            with self.assertRaisesRegex(ValueError, 'Unsafe object name'):
                module.extract(archive, base / 'out')
            self.assertFalse((base / 'out').exists())

    def test_rejects_cyclic_pdata_and_truncated_export(self):
        ref = module.Ref(b'1'*8)
        with self.assertRaisesRegex(ValueError, 'Cyclic'):
            module.file_data(ref, {ref.oid: ('OFS.Image Pdata', {b'data': b'x', b'next': ref})})
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / 'truncated.zexp'
            archive.write_bytes(b'ZEXP' + b'1'*8 + struct.pack('>Q', 100) + b'short')
            with self.assertRaisesRegex(ValueError, 'Truncated'):
                module.read_export(archive)


if __name__ == '__main__': unittest.main()
