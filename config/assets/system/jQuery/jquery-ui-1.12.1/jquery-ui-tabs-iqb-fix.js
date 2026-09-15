// IQB - Dan Barbulescu
// 03.11.2016

// diese JS-Datei ist eine Lösung für das Problem, das jQuery UI Tabs inkompatibel mit unsere aktuelle Zustandsspeicherung-in-der-URL-Methode ist
// als Lösung überschreiben wir die _isLocal Funktion von jQuery UI Tabs, damit die Funktion betrachtet auch unsere baseUrl, wann die entscheidet, ob die Url lokal oder nicht ist


// _isLocal function prototype override path based on: http://stackoverflow.com/a/28683238
// license: cc by-sa 3.0 
// idea by:  d'Artagnan Evergreen Barbosa (http://stackoverflow.com/users/4576412/dartagnan-evergreen-barbosa)

jQuery.ui.tabs.prototype._isLocal = (function() 
{
	    // based on original function from jQuery UI 1.12.1
		// modified for IQB purposes
		// the function as it is in this version of jQuery UI doesn't support the <base> HTML tag
		// added an extra check (anchorUrl === baseUrl), to account for the <base> HTML tag

		var rhash = /#.*$/;
		  
		return function( anchor ) 
		{
			
			var anchorUrl, locationUrl;

			anchorUrl = anchor.href.replace( rhash, "" );
			locationUrl = location.href.replace( rhash, "" );

			// Decoding may throw an error if the URL isn't UTF-8 (#9518)
			try {
				anchorUrl = decodeURIComponent( anchorUrl );
			} catch ( error ) {}
			try {
				locationUrl = decodeURIComponent( locationUrl );
			} catch ( error ) {}

			var baseUrl = $("base").attr("href");
			
			// IQB debuging
			/*
			console.log("anchorUrl" + ": " + anchorUrl);
			console.log("locationUrl" + ": " + locationUrl);
			console.log("baseUrl" + ": " + baseUrl);
			*/
			
			return (anchor.hash.length > 1) && ((anchorUrl === locationUrl) || (anchorUrl === baseUrl)) ;
		}
})();
	