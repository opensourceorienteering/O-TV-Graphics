/**
 * Output test pattern (system graphic, not part of any template set).
 * Used only from Settings to check the real web / NDI output before going live; it is never
 * offered in the live desk. Static colour bars, a grey ramp and safe-area frames, sent
 * through the same output path as competition graphics.
 */
export default class OutputTestPattern extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: 'open' }); }
  async load({ data = {} } = {}) {
    this.shadowRoot.innerHTML = `<style>:host{position:absolute;inset:0;display:block;background:#111;color:white;font:48px Arial,sans-serif}.bars{height:75%;display:flex}.bars span{flex:1}.signal{height:25%;display:flex;align-items:center;justify-content:center;background:linear-gradient(90deg,#000,#777,#fff);text-shadow:0 2px 8px #000}.safe{position:absolute;inset:5%;border:2px solid #fff8;pointer-events:none}.safe:after{content:'';position:absolute;inset:5%;border:2px solid #fff8}h1{font-size:48px;text-align:center;background:#111c;padding:20px 40px;z-index:1}</style><div class="bars">${['#fff','#ff0','#0ff','#0f0','#f0f','#f00','#00f'].map(c => `<span style="background:${c}"></span>`).join('')}</div><div class="signal"><h1></h1></div><div class="safe"></div>`;
    this.shadowRoot.querySelector('h1').textContent = `${data.event?.name || 'Split Control'} · OUTPUT TEST`;
    return { statusCode: 200 };
  }
  async playAction({ goto, delta } = {}) {
    // OGraf v1: one step (step 0); playing past it ends the graphic
    const target = Number.isInteger(goto) && goto >= 0 ? goto : (this.style.display === 'block' ? 0 : -1) + (delta ?? 1);
    if (target >= 1) { await this.stopAction(); return { statusCode: 200, currentStep: undefined }; }
    this.style.display = 'block';
    return { statusCode: 200, currentStep: 0 };
  }
  async stopAction() { this.style.display = 'none'; return { statusCode: 200 }; }
  async updateAction({ data }) { return this.load({ data }); }
  async dispose() { this.shadowRoot.innerHTML = ''; return { statusCode: 200 }; }
}
