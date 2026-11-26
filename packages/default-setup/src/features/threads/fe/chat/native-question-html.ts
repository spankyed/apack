/** Keep HTML previews inside an opaque, scriptless document without external resources or navigation. */
export function nativeQuestionHtmlDocument(fragment: string): string {
  const template = document.createElement('template')
  template.innerHTML = fragment
  function scrub(root: DocumentFragment) {
    for (const element of Array.from(root.querySelectorAll('*'))) {
      if (['script', 'style', 'iframe', 'object', 'embed', 'meta', 'base', 'link', 'form'].includes(element.localName.toLowerCase())) { element.remove(); continue }
      for (const attr of Array.from(element.attributes)) {
        const name = attr.localName.toLowerCase()
        if (name.startsWith('on') || ['srcdoc', 'srcset', 'action', 'formaction', 'target', 'autofocus', 'contenteditable'].includes(name) || ((name === 'href' || name === 'src') && !/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(attr.value))) element.removeAttributeNode(attr)
      }
      if (element instanceof HTMLTemplateElement) scrub(element.content)
    }
  }
  scrub(template.content)
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><meta name="color-scheme" content="dark light"><style>html{color-scheme:dark}body{margin:0;padding:12px;font:13px/1.5 system-ui,sans-serif;color:#e5e5e5;background:#191919;overflow-wrap:anywhere}img,svg,video{max-width:100%}pre{white-space:pre-wrap}*{box-sizing:border-box}</style>${template.innerHTML}`
}
