$(function () {

	var PageIsRoot = false;
	if ($('#pageIsRoot').val() == 'True') PageIsRoot = true; // uses hidden iqb input field to ascertain if currently on homepage

	DesktopImageCheck();
	
	$(window).on('resize', DesktopImageCheck);

	// formt Staff-Table um und wrapt alle tables mit <div class="tablecontainer">
	processContentManipulation();

	//Init Mobile Behavior
	$('#mobilemenu').addClass("jsactive"); 
	$('#subnavigation-mobile').addClass("jsactive"); 

	if (PageIsRoot == false) {
		toggleMenu();
		$('#btn_menu').removeClass("iqb_not_homepage_init");
	};

	/* add transition to menu after page is loaded, so that it doesn't animate if menu is loaded by default */
	$('#mobilemenu').css('-webkit-transition','height 0.4s ease');
	$('#mobilemenu').css('-moz-transition','height 0.4s ease');
	$('#mobilemenu').css('-o-transition','height 0.4s ease');
	$('#mobilemenu').css('-transition','height 0.4s ease');

	$('<link>').attr('rel','stylesheet')
		.attr('type','text/css')
		.attr('href', 'https://www.iqb.hu-berlin.de/system/ibf/iqb_mobile_menu_animations.css')
		.appendTo('head');
	// end of mobile menu init


	// $('#border').sticky({topSpacing:55});  // commented out by Dan Barbulescu for smoother page transitions; 08.05.2017 
	// document.addEventListener("touchstart", function(){}, true); // commented out by Dan Barbulescu for double tap zoom; 08.05.2017 
	$('#main').on("click",function(e) {
		//close menu on click in main content area
		hideMenu();
		$('#mlocation').removeClass("is-active");
	});

	//LocationInit
	var p = getPlatform();
	$('#mlocation').on('click', 'a',function(){
		$('#mlocation').removeClass('is-active');
	});
	
	$('#mlocation a.applink').each(function(i,item){
		var loc = "";
		loc = $(item).attr('geo');
		loc = loc.replace('#',',');
		var defaultref = "http://maps.google.com/maps?q=loc:"+ loc +"&navigate=yes";
		var android = "geo:"+ loc;
		var apple ="http://maps.apple.com/?q="+ loc +"&navigate=yes";
		var win ="maps:"+loc;

		//Default
		var link = defaultref;
		if (p == "iOS") {
			link = apple;
		} else {
			if (p == "Android") {
				link = android;
			} else {
				if (p == "WindowsPhone") {
					link = win;
				}
			}
		};

		$(item).attr('href', link)
	});

	//Buttons
	//Location
	$('#mobile_anfahrt').click(function(e){
		hideMenu();
		var loccontainer = $('#mlocation')

		loccontainer.toggleClass("is-active");
		if (loccontainer.hasClass('is-active')){
			window.scrollTo(0,0);    
		};
		e.preventDefault();
	});
	
	//MENü
	$('#btn_menu').click(function(){
		$('#mlocation').removeClass("is-active");
		toggleMenu();
	});

	var lastmenu = {nav:null,target:null};
	$.each($('#mobilemenu .secondmenu'), function(key, value){ 		// Dan Barbulescu 03.07.2017 - if menu already opened, properly initialize the variable lastmenu
		if ($(this).hasClass("is-active"))
		{
			lastmenu.target = this;
			lastmenu.nav = $(this).parent().parent().find('.subnavimobile').eq(0);			
		}
	});
		
	$('#mobilemenu .secondmenu').click(function(e){
		console.log(lastmenu);
		var target =$(e.currentTarget);
		var subnav = target.parent().parent().find('.subnavimobile').eq(0);

		if (subnav != undefined) {
			//CLOSE old
			if (lastmenu.nav != null) {
				lastmenu.nav.toggleClass('is-active');
				$(lastmenu.target).toggleClass('is-active');
			}

			//SET old / null
			if (lastmenu.target == e.currentTarget) {
				lastmenu.nav=null;
				lastmenu.target=null;
			} else {
				lastmenu.nav=subnav;
				lastmenu.target=e.currentTarget;


				setTimeout(function(){
					window.scrollTo(0,0);    

					var d = $('#mobilemenu');
					var dy = target.position().top - 25; //d.scrollTop()-
					/*
					var dh =d.prop("scrollHeight")
					console.log(dy);
					var mh =    $('#mobilemenu').children().eq(0).height();
					console.log(mh);
					console.log(dh);
					*/
					/* console.log(subnav.position());
					console.log(target.position());
					console.log(dy);
					console.log(d.scrollTop());*/

					subnav.toggleClass("is-active");
					target.toggleClass("is-active");
					d.animate({scrollTop:0},'fast')
						.animate({scrollTop:dy},'fast');
				},300);
			}
		}
	});

	//SUCHE
	$('#btn_search').click(function(e){
		var  x =$('#searchmobile').find('.search').eq(0);
		x.val("");
		$('#searchmobile').fadeIn('slow'); 
		x.focus();
		$('body').addClass("noscroll");
		e.preventDefault();
	});
	
	//Click Search
	$('#btn_submit_search').click(function(e){
		closeMobileSearch()
	});
	
	//Click X 
	$('#btn_exit_search').click(function(e){
		closeMobileSearch();
		e.preventDefault();
	});
	
	//Click on screen    
	$('#searchmobile').click(function(e){
		if ($(e.target).attr('id') == 'searchmobile') {
			closeMobileSearch();
		}
	});    

	//using history as indicator 

	if (typeof (history.pushState) != "undefined") {

		$('body').on("click","a",function(e){
			var linktag = $(this);

			/*
			// commented out (disabled) by Dan Barbulescu for all links except subnavigation-mobile-link
			// 08.05.2017

			if(linktag.attr('href')!="#" && ! linktag.hasClass("applink") && ! linktag.hasClass("reference") ){
			var link = linktag.attr('href');
			var text = linktag.text();
			loadContent(link, text);
			e.preventDefault();
			}
			*/
			if (linktag.hasClass("subnavigation-mobile-link")) {
				loadSubNavigationContent(linktag);
				e.preventDefault();
			}
		});
	};

	//TEMPCACHE for loaded scripts
	var scriptsloaded = [];
	var stylesloaded = [];

	$.each($('html').find('link'), function( key, value ) {
		if (typeof $(this).attr('href') != 'undefined') {
			stylesloaded.push($(this).attr('href'));
		}
	});

	$.each($('html').find('script'), function( key, value ) {
		if (typeof $(this).attr('src') != 'undefined') {
			scriptsloaded.push($(this).attr('src'));
		}
	});

	// Dan Barbulescu - 03.07.2017
	// make current page in mobile menu appear as bold
 	$.each($("a[href='" + document.URL + "']"), function( key, value ) { // look in all links that contain current URL
		if ($(this).length > 0) // if element exists
		{
			if ($(this).closest("ul").length > 0) // if element has an ul element as a parent
			{			
				if ($(this).closest("ul").hasClass("iqb_mobilemenu_active_bold")) $(this).css('font-weight', 'bold'); // if the link is located inside an iqb_mobilemenu_ul list, make it bold
			}
		}
	});
	
	return;

}); // init


// # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
//  # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #


// #################################################
/* If screen size is big enough, show images which are supposed to only be loaded for bigger screens */
function DesktopImageCheck()
{
	if ($(window).width() >= 960) {
		$.each($('.iqb_desktop_image'), function(){
			if ($(this).attr('src') != $(this).attr('data-src')) $(this).attr('src', $(this).attr('data-src'));
		});
	}
}

// #################################################
function processContentManipulation(htmlelement)
{
	if (htmlelement==undefined || htmlelement ==null){
		htmlelement = $('#main')
	};
	// buildStafftable(htmlelement);
	processtables(htmlelement);
}

// #################################################
function buildStafftable(htmlelement)
{
	console.log("staff");
	$(htmlelement).find('table.staff').each(function(i,table){
		var parent = $(table).parent();
		var mdiv = $('<div class="staff_container"></div>');

		$(table).find("tr").each(function(i,row){
			if (i == 0) {
				var heading = $(row).find('th').eq(0).text();
				console.log(heading);
				mdiv.append('<div class="heading">'+heading+'</div>');
			} else {
				var name = $(row).find('td').eq(0).text();
				var kontakt = $(row).find('td').eq(2).text();
				var tel = $(row).find('td').eq(1).text();

				/* console.log(name)
				console.log(kontakt)
				console.log(tel)*/
				if (name != "") {
					var div =$('<div class="staff"></div>');
					tel = "+49 30 2093-" + tel;
					div.append('<div class="staff_name">'+name+'</div>');
					div.append('<div class="staff_tel"><a href="tel:'+tel+'">'+tel+'</a></div>');
					div.append('<div class="staff_kontakt"><a href="mailto:'+kontakt+'">'+kontakt+'</a></div>');
					mdiv.append(div);
				}
			}

		})
		console.log(mdiv)
		$(parent).append(mdiv)
		$(table).remove();
	})
}

// #################################################
function processtables(htmlelement)
{
	htmlelement.find('table').each(function(i,t){
		if (!$(t).parent().hasClass("tablecontainer")) {
			$(t).wrap('<div class="tablecontainer">');
		}
	})
}

// #################################################
// MENU functions
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 function hideMenu()
 {
	var btn = $('#btn_menu');
	var mm = $('#mobilemenu');
	btn.removeClass('is-active');

	mm.removeClass('is-active');
	mm.addClass('not-active');
}

// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
function toggleMenu()
{
	var btn = $('#btn_menu');
	var mm = $('#mobilemenu');
	var deltaY = window.scrollY;
	var heightmenu = $('#mobilemenu').height();

	btn.toggleClass('is-active');

	mm.toggleClass('is-active');
	if (mm.hasClass('is-active') == false) {
		mm.addClass('not-active');
	} else {
		mm.removeClass('not-active');
	};

	if (mm.hasClass('is-active')){
		window.scrollTo(0,0);    
	} else {
		if (deltaY > heightmenu) {
			window.scrollTo(0, deltaY-heightmenu);   
		}
	}
};

// #################################################
function getPlatform() 
{
	var userAgent = navigator.userAgent || navigator.vendor || window.opera;

	// Windows Phone must come first because its UA also contains "Android"
	if (/windows phone/i.test(userAgent)) {
		return "WindowsPhone";
	}

	if (/android/i.test(userAgent)) {
		return "Android";
	}

	// iOS detection from: http://stackoverflow.com/a/9039885/177710
	if (/iPad|iPhone|iPod/.test(userAgent) && !window.MSStream) {
		return "iOS";
	}

	return "unknown";
}

// #################################################
/*Subnavigation Accordion*/
function loadSubNavigationContent(linktag)
{
	var link = linktag.attr('href');

	//close other ??
	//  var isopen = linktag.attr('loaded') && linktag.next().hasClass('is-active')
	//  linktag.parent().parent().find('.is-active').removeClass('is-active');


	if (linktag.attr('loaded') != undefined) {
		var contentcontainer = linktag.next();
		//close other ??
		//       if(!isopen){
		linktag.toggleClass('is-active');
		contentcontainer.toggleClass('is-active');
		//       }
	} else {
		var contentcontainer = $('<div class="accordion-container">'); 
		var content = $('<div class="accordion-content">'); 
		contentcontainer.append(content);
		contentcontainer.insertAfter(linktag);

		$.get(link,function(html){
			linktag.attr('loaded','true');
			$.when(embedScript(html)).then(function(){
				console.log('scripts loaded');
				var htmlmaincontent = $(html).find('#maincontent').eq(0);

				htmlmaincontent.removeAttr("id");
				processContentManipulation(htmlmaincontent)
				content.append(htmlmaincontent.html());
				contentcontainer.toggleClass('is-active');
				linktag.toggleClass('is-active');
			});

			//loadsub
			$(linktag).parent().find('ul.subnavi-mobile.lvl3 > li > a').each(function(index, item){
				var lvl3_link = $(item).attr('href');
				var lvl3_title = $(item).text()
				$.get(lvl3_link,function(lvl3html){
				$.when(embedScript(html)).then(function(){
					console.log('scripts loaded');

					var lvl3_htmlmaincontent =$('<div class="content lvl3">').append( $(lvl3html).find('#maincontent').eq(0).removeAttr("id"));
					processContentManipulation(lvl3_htmlmaincontent);
					content.append('<h3 class="heading lvl3">'+ lvl3_title +'</h3>');
					content.append(lvl3_htmlmaincontent.html())
					});
				})
			});
		})
	}
}

// #################################################
function loadContent(link,text)
{
	console.log("fetch data " + text);
	$.get(link,function(html){
		try {
			embedScript(html);
			// html = html.replace(/<script[^>]*>((\r|\n|.)*?)<\/script[^>]*>/mg, '');  //Removing <script> tags, because we don't want to execute them
			html = html.replace(/(<html|<head|<body|<\/html|<\/head|<\/body)/ig, '$1a'); //FIX body --> bodya, head -->heada
			var _html = $(html);
			//Extract <head>
			var title = _html.find('heada').eq(0).find('title').eq(0).text();
			document.title =title;
			//Extract <body>
			var html_body = $(html).find('bodya').eq(0);
			processContentManipulation(html_body)
			$('#main').empty().html(html_body.find('#main').eq(0).html());
			//Change url in browser to reload the right page
			ChangeUrl(text, link);
			//Set body class
			var newbodyclass = $(html_body).attr("class");
			$('body').removeClass().addClass(newbodyclass);
			window.scrollTo(0,50);   
		} catch(e) {
			//force reload
			window.location=link;
		}
	});
}

// #################################################
function closeMobileSearch(){
	$('#searchmobile').fadeOut('fast');   
	$('body').removeClass("noscroll") ;
}

// #################################################
//activate SPA-Feeling
//HelperFunc
function ChangeUrl(page, url) {
	if (typeof (history.pushState) != "undefined") {
		var obj = {Page: page, Url: url};
		history.pushState(obj, obj.Page, obj.Url);
	}
};

// #################################################
function embedScript(html)
{
	/*
	var r=[]; //promise Array 
	*/

	var mainDef = $.Deferred();
	html=html.replace(/(<html|<head|<body|<\/html|<\/head|<\/body)/ig, '$1a'); //FIX

	//Styles
	$(html).find('heada').eq(0).find("link").each(function(i, style){
		var link_to_css = $(style).attr("href");
		if ($(style).attr("base") == undefined && stylesloaded.indexOf(link_to_css) == -1) {
			/*
			console.log('load style')
			console.log(link_to_css)
			*/
			stylesloaded.push(link_to_css);
			$('<link>').attr('rel','stylesheet')
				.attr('type','text/css')
				.attr('href',link_to_css)
				.appendTo('head');
		}
	});
	
	$(html).find('heada').eq(0).find("script").each(function(i,script){
		if ($(script).attr("src") != undefined && $(script).attr("base") == undefined && scriptsloaded.indexOf($(script).attr("src"))==-1) {
			/*
			console.log(script);
			*/
			scriptsloaded.push($(script).attr("src"));
			/* var d1 = $.Deferred();
			r.push(d1)*/
			$.ajax({ url: $(script).attr("src"), dataType: "script", async: false },function(){d1.resolve()});
			//document.head.appendChild();
			//document.body.appendChild(script)
		}//END IF
	}); //END EACH

	/*
	console.log(r);
	$.when.apply($, mainDef).done(function(){
	console.log('all scripts loaded');
	mainDef.resolve();
	})
	*/
	mainDef.resolve();

	return mainDef;
} 
