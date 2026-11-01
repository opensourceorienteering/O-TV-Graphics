// Lists the looks zipped by scripts/zip-looks.sh (looks/looks.json) with download buttons.
(function () {
  const list = document.getElementById("looks");
  const status = document.getElementById("looks-status");
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const kb = (bytes) => (bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(bytes / 1e3)} KB`);

  fetch("looks/looks.json")
    .then((res) => {
      if (!res.ok) throw new Error(res.status);
      return res.json();
    })
    .then(({ looks }) => {
      status.textContent = `${looks.length} looks. Each zip works with the latest Split Control.`;
      list.innerHTML = looks
        .map(
          (look) => `
        <article class="card look">
          <div class="swatches" aria-hidden="true">${look.colors.map((c) => `<span style="background:${esc(c)}"></span>`).join("")}</div>
          <h3>${esc(look.name)}${look.builtIn ? ' <span class="badge">Comes with the app</span>' : ""}</h3>
          <p>${esc(look.description)}</p>
          <p class="meta">${look.graphics} graphics${look.fonts ? ` · ${esc(look.fonts)}` : ""}</p>
          <a class="pv-try" href="preview/?look=${encodeURIComponent(look.id)}">Try it in the preview →</a>
          <a class="button ${look.builtIn ? "" : "primary"}" href="looks/${encodeURIComponent(look.file)}" download>
            Download · ${kb(look.size)}</a>
        </article>`
        )
        .join("");
    })
    .catch(() => {
      status.innerHTML =
        'Couldn\'t load the list of looks. Find them in the <a href="https://github.com/opensourceorienteering/O-TV-Graphics/tree/main/templates/sets">templates/sets folder on GitHub</a>.';
    });
})();
