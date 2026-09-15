$(function () {
	// registriere Click-Handler an Service-
	$(".servicemenulink.search").click(showServiceMenu);
	$(".servicemenulink.login").attr('href', 'https://www2.iqb.hu-berlin.de/p');
	if ($('#pageIsAuthenticatedUser').val() == 'True') {
		$(".servicemenulink.login").text('Portale');
	};

	$(".overlay .close").click(hideServiceMenu);

	// und Sprungmenu
	$("#slideout .opener").click(toggleSlideout);

	if ($('#pageIsRoot').val() == 'True') {
	  	// Initialisiere Slideshow im Moodbereich
		if ($('.startseite #slides').length > 0) {
			$('.startseite #slides').slides({
				preload: true,
				preloadImage: 'system/img/loading.gif',
				paginationNext: true,
				play: 5000,
				pause: 2500,
				hoverPause: true
			});
		}
	};

	if ($('#leadtext_div').length > 0) {
		$.getJSON('user_LeadTextShow' + $('#leadtext_button').val(),
			function(data) { 
				if (data == '1') {
					$('#leadtext_div').show();
					$('#leadtext_button').text('Text ausblenden');
					$('#leadtext_button').css("background-color","#eee");
				}
			});

	};
	var pfntxt = $("#page-footnote-maintainer").text();
	var sftxt = $("#page-footnote-secretfile").text();
	// hack to disable alert
	// if (pfntxt.length > 0 || sftxt.length > 0) {
	if (1 > 2) {
		$("#page-footnote").hover(function() {
		    $(this).css('cursor','pointer');
		}, function() {
		    $(this).css('cursor','auto');
		});
		if (pfntxt.length > 0) {
			$("#page-footnote-maintainer").click(webmasteralert);
		}
		if (sftxt.length > 0) {
			$("#page-footnote-secretfile").click(secretFileDialog);
		}
	};
}) // init


// ##################################################################################
/* Funktion zum Schließen aller Service-Menu-Einträge (.overlay) */
function hideAllServiceMenus() {
	var overlays = $("#service-menu .overlay");
	overlays.css("display", "none")
}

// ##################################################################################
/* Event für einen ServiceMenu-CloseButton, Schließe Service-Menu-Eintrag (.overlay) */
function hideServiceMenu(e) {
	var target = $(e.currentTarget);
	var overlay = $(target).parent(".overlay");
	overlay.css("display", "none")
}

// ##################################################################################
/* Event für einen ServiceMenu-Button, Öffnet ein Service-Menu-Eintrag (.overlay) */
function showServiceMenu(e) {
	hideAllServiceMenus();
	var target = $(e.currentTarget);
	var parent= $(target).parent("li");
	var overlay = parent.find(".overlay");
	overlay.css("display", "block")
	e.preventDefault();
}

// ##################################################################################
/* Öffnet oder schließt die Sprungnavigation abhängig von aktuellen Zustand*/
function toggleSlideout(e) {
	var slideout = $("#slideout");
	var right = slideout.css("right");
	var target_right = "0px";
	var open = true;
	if (right == "0px")
	{
		target_right = "-244px";
		open = false;
	}
	slideout.animate(
		{right: target_right},
		{complete: function () { slideout.toggleClass("open"); } }
		);
	// Hier könnte per Cookie in Browser oder per XHR auf dem Server
	// gespeichert werden, ob die Sprungnavigation offen ist.
}

// ##################################################################################
/* Öffnet Eingabefenster für Nachricht an Webmaster */
function webmasteralert(e) {
	var target = $(e.currentTarget);
	var title = ($('#pagelanguage').val() == 'en' ? 'Feedback to web-page (' : 'Rückmeldung zu einer Seite (') + target.text() + ')';
	var prompt = $('#pagelanguage').val() == 'en' ? 'Please use the inputbox to send a comment to IQB!' : 'Bitte nutzen Sie das Eingabefeld, um dem IQB eine Nachricht über diese Seite zu schicken!';
	showInputDialog(title, prompt, $('#pagelanguage').val() == 'en' ? 'Send Message' : 'Abschicken',
		function (inputstr) {
			$.post('webmasterpost', {'p': inputstr, 'u': $(location).attr('href'),
				'w': target.text(), 'lang': $('#pagelanguage').val()}, function(Data) {
					showMsg(Data)
			}, "json");
		}, '', true);
}

function secretFileDialog(e) {
	var dialogboxdiv = $('#page-footnote-secretfile-dialog');
	
	var buttondef = {};
	buttondef[$('#pagelanguage').val() == 'en' ? 'Send Request' : 'Abschicken'] = function () {
						$( this ).dialog( "close" );
						$.post('limitedDownloadSendLinks', {'e': dialogboxdiv.find('#secretfile-email').val(), 'c': dialogboxdiv.find('#secretfile-code').val(), 'f': $(location).attr('href'),
							'lang': $('#pagelanguage').val(), 'id': GenerateUniqueID()}, function(Data) {
								showMsg(Data)
						}, "json");
					};
	buttondef[$('#pagelanguage').val() == 'en' ? "Cancel" : "Abbrechen"] = function() {
						$( this ).dialog( "close" );
					};
	dialogboxdiv.dialog({
			height: 500,
			width: 440,
			modal: true,
			buttons: buttondef
		});
}

// ##################################################################################
// ##################################################################################
function showInputDialog(title, prompt, OKButtonLabel, OKButtonFunction, InputPreset, multiline) {
	var dialogboxdiv = $('#dialog-form-textinput');
	var dialogboxwidth = 440;
	var dialogboxheight = 500;
	if (typeof multiline === "undefined") {
		dialogboxdiv = $('#dialog-form-prompt');
		dialogboxwidth = 350;
		dialogboxheight = 200;
	};
	dialogboxdiv.find('p:first').text(prompt);
	dialogboxdiv.find('#userinput').show();
	dialogboxdiv.find('#userinput').val(InputPreset);
	
	var buttondef = {};
	buttondef[OKButtonLabel] = function () {
						$( this ).dialog( "close" );
						OKButtonFunction(dialogboxdiv.find('#userinput').val());
					};
	buttondef[$('#pagelanguage').val() == 'en' ? "Cancel" : "Abbrechen"] = function() {
						$( this ).dialog( "close" );
					};
					
	dialogboxdiv.dialog({
			title: title,
			height: dialogboxheight,
			width: dialogboxwidth,
			modal: true,
			buttons: buttondef
		});
}

// ##################################################################################
// selectionlist: name / id
function showSelectionDialog(title, prompt, selectionlist, OKButtonLabel, OKButtonFunction, Preselect) {
	$('#dialog-form-select').attr('title', title);
	$('#dialog-form-select').find('p:first').text(prompt);
	$('#dialog-form-select #userselection').empty();
	for (s in selectionlist) {
		var selectedstr = '';
		if (selectionlist[s]['id'] == Preselect) {selectedstr = ' selected="selected"'};
		$('#dialog-form-select #userselection').append('<option value="' + selectionlist[s]['id'] + '"' + selectedstr + '>' + selectionlist[s]['name'] + '</option>');
	};
	
	var buttondef = {};
	buttondef[OKButtonLabel] = function () {
						$( this ).dialog( "close" );
						OKButtonFunction($('#dialog-form-select #userselection').val());
					};
	buttondef[$('#pagelanguage').val() == 'en' ? "Cancel" : "Abbrechen"] = function() {
						$( this ).dialog( "close" );
					};
					
	$('#dialog-form-select').dialog({
			height: 350,
			width: 350,
			modal: true,
			buttons: buttondef
		});
}

// ##################################################################################
function showMsgBox(infotext, title) {
	if (typeof title == 'undefined' || title == null || title.length == 0) {
		if (infotext.substr(0,2) == "i:") {
			title = 'Information';
			infotext = infotext.substr(2);
		} else if (infotext.substr(0,2) == "w:") {
			title = 'Warnung';
			infotext = infotext.substr(2);
		} else if (infotext.substr(0,2) == "e:") {
			title = 'Fehler';
			infotext = infotext.substr(2);
		} else {
			title = 'Information';
		}
	};
	$('#dialog-form-prompt').attr('title', title);
	$('#dialog-form-prompt').find('p:first').text(infotext);
	$('#dialog-form-prompt #userinput').hide();
	
	$('#dialog-form-prompt').dialog({
			height: 200,
			width: 350,
			modal: true,
			buttons: { OK: function () {$( this ).dialog( "destroy" );}}
		});
}

// ##################################################################################
function showMsgBoxHtml(infotextHtml, title) {
	if (typeof title == 'undefined' || title == null || title.length == 0) {
		if (infotextHtml.substr(0,2) == "i:") {
			title = 'Information';
			infotextHtml = infotext.substr(2);
		} else if (infotextHtml.substr(0,2) == "w:") {
			title = 'Warnung';
			infotextHtml = infotext.substr(2);
		} else if (infotextHtml.substr(0,2) == "e:") {
			title = 'Fehler';
			infotextHtml = infotext.substr(2);
		} else {
			title = 'Information';
		}
	};
	$('#dialog-form-prompt').attr('title', title);
	$('#dialog-form-prompt').find('p:first').replaceWith(infotextHtml);
	$('#dialog-form-prompt #userinput').hide();
	
	$('#dialog-form-prompt').dialog({
			height: 500,
			width: 450,
			modal: true,
			buttons: { OK: function () {$(this).dialog('destroy')}}
		});
}

// ##################################################################################
function confirmBox(questiontext, title, YesButtonFunction, NoButtonFunction, CancelButtonFunction) {
	$('#dialog-form-prompt').attr('title', title);
	$('#dialog-form-prompt').find('p:first').text(questiontext);
	$('#dialog-form-prompt #userinput').hide();
	
	$('#dialog-form-prompt').dialog({
			height: 300,
			width: 550,
			modal: true,
			buttons: {
				'Ja': function () {
					$( this ).dialog( "destroy" ); YesButtonFunction()},
				'Nein': function () {
					$( this ).dialog( "destroy" ); NoButtonFunction()},
				'Abbrechen': function () {
					$( this ).dialog( "destroy" ); CancelButtonFunction()}
				}
		});
}
// ##################################################################################
// blendet für bestimmte Zeit Meldung ein; data: string; kann mit e: oder w: beginnen, dann Optik enspr. Error bzw. Warning
function showMsg(data) {
	var msg = '';
	var ftype = 'i';
	if (data.substr(0,2) == "i:" || data.substr(0,2) == "w:" || data.substr(0,2) == "e:") {
		ftype = data.substr(0, 1);
		msg = data.substr(2);
	} else {
		ftype = "i";
		msg = data;
	};

	var element="#footer";
	if(!$(element).is(':visible')) {
		switch (ftype) {
			case "w":
				$(element+' .msgbox img.msgbox-img').attr('src','/system/img/warning-48.png');
				var typedesc = $('#pagelanguage').val() == 'en' ? "Warning" : "Warnung";
				var typename = "warning";
				var msgwidth = 530;
				break;
			case "i":
				$(element+' .msgbox img.msgbox-img').attr('src','/system/img/info-48.png');
				var typedesc = "Information";
				var typename = "info";
				var msgwidth = 500;
				break;
			case "e":
				$(element+' .msgbox img.msgbox-img').attr('src','/system/img/critical-48.png');
				var typedesc = $('#pagelanguage').val() == 'en' ? "Error" : "Fehler";
				var typename = "error";
				var msgwidth = 550;
				break;
		};
		if(msg.length < 50){
			$('.msgbox span').css({"font-size":"18px", "line-height":"47px"});
		}
		else if(msg.length < 100){
			$('.msgbox span').css({"font-size":"13px", "line-height":"15px", "padding-top": "7px"});
		} 
		else {
			$('.msgbox span').css({"font-size":"10px", "line-height":"14px"});
		};
		$(element+' .msgbox span.msgbox-text').html(msg);
		$(element+' .msgbox span.msgbox-text').css("width", msgwidth);
		$(element+' .msgbox').addClass(typename);
		$(element+' .msgbox img.msgbox-img').attr('alt',typedesc);
		$(element+' .msgbox h5').html(typedesc);
		$(element).fadeToggle();
		$(element).delay(5000).fadeToggle(function () {
			$(element+' .msgbox').removeClass(typename)
		});
	}
};

// ##################################################################################
// Status "Warten": zeigt langwierige (AJAX-)Prozesse an 
function setWaiterOn() {
//	$('#waiter').show('normal');
	$('#waiter').fadeIn('normal');
}

// ##################################################################################
// stellt "Wartestatus" aus
function setWaiterOff() {
//	$('#waiter').hide('normal');
	$('#waiter').fadeOut('normal');
}

// ##################################################################################
function GenerateUniqueID() {
	var secondsSinceEpoch = ($.now() / 1000) | 0;
	var secondsInDay = ((secondsSinceEpoch % 86400) + 86400) % 86400;
	return ((secondsInDay + 1000000000) * Math.floor(Math.random()*8999) + 1000).toString(22) 
		+ ((secondsInDay + 1000000000) * Math.floor(Math.random()*8999) + 1000).toString(30);
}

// ##################################################################################
function GetFileSizeStr(filesize) {
	filesize = Math.round(filesize / 1024);
	if (filesize < 1) {
		if (filesize == 0) {
			return '0'
		} else {
			return '< 1 kB'
		}
	} else {
		if (filesize < 10) {
			return filesize.toFixed(0) + ' kB'
		} else {
			if (filesize < 1000) {
				return filesize.toFixed(-1) + ' kB'
			} else {
				return Math.round(filesize / 1000).toFixed(1) + ' MB'
			}
		}
	}
}

// ##################################################################################
/* Funktionen für Hash-Handling */
function GetState(stateId, defaultvalue) {
	var myState = History.getState();
	var myStateData = myState['data'];
	if (typeof myStateData === "undefined") {
		return defaultvalue
	} else {
		if (myStateData[stateId] == "undefined") {
			return defaultvalue
		} else {
			return myStateData[stateId] || defaultvalue;
		}
	}
}

function SetState(stateId, newvalue, force) {
	var myState = History.getState();
	var myStateData = myState['data'];
	if (typeof myStateData === "undefined") myStateData = {};
	var oldvalue = myStateData[stateId];
	myStateData[stateId] = newvalue;
	
	urlstr = '';
	for (var key in myStateData) {
		if (myStateData.hasOwnProperty(key)) {
			if (urlstr.length == 0) {
				urlstr = '?' + key + '=' + myStateData[key];
			} else {
				urlstr += '&' + key + '=' + myStateData[key];
			}
		}
	}
	History.pushState(myStateData, document.title, urlstr);
	if ((oldvalue == newvalue) && (force == true)) {
		$(window).trigger('statechange');
	}
}

// ##################################################################################
/* Funktion für Auswertung Query-String */
function GetUrlValue(VarName, DefaultValue) {
	var hashes = window.location.href.slice(window.location.href.indexOf('?') + 1).split('&');
	for(var i = 0; i < hashes.length; i++) {
		var hash = hashes[i].split('=');
		if (hash[0] == VarName) {
			return hash[1];
		};
        }
        return DefaultValue;
};

// ##################################################################################
/* Funktion für Vorspann-Text */
function ToggleLeadText() {
	if ($('#leadtext_div').length > 0) {
		if ($('#leadtext_div').is(':hidden')) {
			$('#leadtext_div').show();
			$('#leadtext_button').text('Text ausblenden');
			$('#leadtext_button').css("background-color","#eee");
		} else {
			$.getJSON('user_LeadTextRead' + $('#leadtext_button').val(),
				function(data) { 
					$('#leadtext_div').hide();
					$('#leadtext_button').text('');
					$('#leadtext_button').css("background-color","transparent");
				});
		}
	};
}

function IsMSIE() {
	return (navigator.appVersion.indexOf("MSIE")!=-1);
}