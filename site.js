const button = document.getElementById("copy-url");
const url = document.getElementById("repo-url");

button?.addEventListener("click", async () => {
  const text = url?.textContent?.trim() ?? "";
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied! ✨";
  } catch {
    // Clipboard can be unavailable (http, old browsers): select the text instead.
    const range = document.createRange();
    range.selectNodeContents(url);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    button.textContent = "Press copy ✂️";
  }
  setTimeout(() => {
    button.textContent = "Copy URL";
  }, 2000);
});
