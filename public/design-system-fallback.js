(() => {
  const cdnStylesheetId = 'gamb-design-system-cdn';
  const localStylesheetId = 'gamb-design-system-local';
  const cdnTimeoutMs = 2500;

  let fallbackTimer;
  let fallbackActivated = false;

  const activateLocalStylesheet = (reason) => {
    if (fallbackActivated) return;

    const localStylesheet = document.getElementById(localStylesheetId);
    if (!(localStylesheet instanceof HTMLLinkElement)) return;

    fallbackActivated = true;
    window.clearTimeout(fallbackTimer);
    localStylesheet.media = 'all';
    localStylesheet.dataset.fallbackReason = reason;
  };

  const monitorStylesheets = () => {
    const cdnStylesheet = document.getElementById(cdnStylesheetId);
    const localStylesheet = document.getElementById(localStylesheetId);

    if (!(localStylesheet instanceof HTMLLinkElement)) return false;

    if (!(cdnStylesheet instanceof HTMLLinkElement) || !cdnStylesheet.href) {
      activateLocalStylesheet('cdn-missing');
      return true;
    }

    cdnStylesheet.addEventListener(
      'load',
      () => window.clearTimeout(fallbackTimer),
      { once: true },
    );
    cdnStylesheet.addEventListener(
      'error',
      () => activateLocalStylesheet('cdn-error'),
      { once: true },
    );

    fallbackTimer = window.setTimeout(
      () => activateLocalStylesheet('cdn-timeout'),
      cdnTimeoutMs,
    );

    return true;
  };

  if (!monitorStylesheets()) {
    const stylesheetObserver = new MutationObserver(() => {
      if (monitorStylesheets()) stylesheetObserver.disconnect();
    });

    stylesheetObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }
})();
