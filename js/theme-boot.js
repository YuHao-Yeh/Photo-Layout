// Applies the saved theme before the page is first drawn, so it never flashes
// the default look. Loaded as a normal (blocking) script in <head>; app.js
// takes over after that. Kept in its own file because the Content Security
// Policy forbids inline scripts.
(function () {
  var themes = ['sky', 'wave', 'candy', 'tiles', 'classic'];
  var theme = 'sky';
  try {
    var saved = JSON.parse(localStorage.getItem('photo-layout:settings') || '{}').theme;
    if (themes.indexOf(saved) >= 0) theme = saved;
  } catch (e) {
    // Storage blocked or unreadable: keep the default theme.
  }
  document.documentElement.dataset.theme = theme;
  if (theme === 'sky' || theme === 'wave' || theme === 'candy') {
    document.documentElement.classList.add('aero');
  }
})();
