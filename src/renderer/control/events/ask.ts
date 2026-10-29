/** Electron does not implement window.prompt. Use a native HTML dialog for short edits. */
export function ask(message: string, initial = ""): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "studio-panel studio-dialog studio-prompt";
    const form = document.createElement("form");
    form.className = "studio-form";
    const label = document.createElement("label");
    label.textContent = message;
    const input = document.createElement("input");
    input.value = initial;
    label.append(input);
    const buttons = document.createElement("div");
    buttons.className = "row";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "studio-button";
    cancel.textContent = "Cancel";
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "studio-button primary";
    submit.textContent = "Save";
    buttons.append(cancel, submit);
    form.append(label, buttons);
    dialog.append(form);
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    cancel.addEventListener("click", () => finish(null));
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      finish(null);
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      finish(input.value);
    });
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
    input.select();
  });
}
