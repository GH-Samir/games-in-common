(function () {
  var root = document.documentElement;

  var theme = localStorage.getItem('gic-theme') || 'system';
  var resolvedTheme = theme === 'system'
    ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  root.setAttribute('data-theme', resolvedTheme);

  root.setAttribute('data-accent', localStorage.getItem('gic-accent') || 'blue');
  root.setAttribute('data-density', localStorage.getItem('gic-density') || 'comfortable');

  var reduceMotionStored = localStorage.getItem('gic-reduce-motion');
  var reduceMotion = reduceMotionStored !== null
    ? reduceMotionStored === 'true'
    : Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  root.setAttribute('data-reduce-motion', String(reduceMotion));
})();
