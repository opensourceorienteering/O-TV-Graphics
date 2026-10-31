// Fills the download cards from the latest GitHub release.
// Without a release (or if GitHub can't be reached) the cards link to the releases page.
(function () {
  const REPO = "opensourceorienteering/O-TV-Graphics";
  const RELEASES = `https://github.com/${REPO}/releases`;

  // Which release file goes on which card. Names come from electron-builder.json.
  const FILES = {
    mac: (n) => /mac-arm64\.dmg$/i.test(n) || /arm64\.dmg$/i.test(n),
    "win-setup": (n) => /windows-setup\.exe$/i.test(n) || /setup.*\.exe$/i.test(n),
    "win-portable": (n) => /windows-portable\.exe$/i.test(n),
  };

  const status = document.getElementById("release-status");
  const size = (bytes) => `${Math.round(bytes / 1e6)} MB`;

  const BUILDS = `https://github.com/${REPO}/actions/workflows/build.yml?query=branch%3Amain+is%3Asuccess`;

  function noRelease(message, link, label) {
    if (status) status.innerHTML = message;
    document.querySelectorAll("[data-download]").forEach((a) => {
      a.href = link;
      a.textContent = label;
    });
  }

  fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json" },
  })
    .then((res) => {
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
      return res.json();
    })
    .then((release) => {
      if (!release) {
        noRelease(
          "There is no published release yet. Until the first one, test builds are on the " +
            `<a href="${BUILDS}">Build page</a> (you need to be signed in to GitHub).`,
          BUILDS,
          "Get a test build"
        );
        return;
      }
      const date = new Date(release.published_at).toLocaleDateString(undefined, {
        year: "numeric", month: "long", day: "numeric",
      });
      if (status) {
        status.innerHTML =
          `Latest version: <strong>${release.tag_name}</strong>, released ${date}. ` +
          `<a href="${release.html_url}">What's new</a>`;
      }
      document.querySelectorAll("[data-download]").forEach((a) => {
        const asset = release.assets.find((x) => FILES[a.dataset.download](x.name));
        if (asset) {
          a.href = asset.browser_download_url;
          const meta = a.parentElement.querySelector(".meta");
          if (meta) meta.textContent = `${asset.name} · ${size(asset.size)}`;
        } else {
          a.href = release.html_url;
          a.textContent = "See the release";
        }
      });
    })
    .catch(() => {
      noRelease(
        `Couldn't check for the latest version. Find it on the <a href="${RELEASES}">releases page</a>.`,
        RELEASES,
        "See all releases"
      );
    });
})();
