/**
 * Classic, modernised: shared overrides for the four hand-made Classic graphics (results list,
 * split lower thirds, countdown). Appended after each graphic's own CSS so the same selectors
 * win. Matches classic/theme.css (the core-based Classic graphics):
 *  - broadcast-size type in px (the originals used rem, i.e. 16 px of the host page)
 *  - contrast: deeper teal under white times, dark text on mint and yellow
 *  - motion: expo-out entries (panel rises, header wipes, rows and time cells stagger in),
 *    short accelerating exits; transform and opacity only
 */

const TOKENS = `
  :host {
    --cl-text: #1d0d18;
    --cl-muted: #5b4753;
    --cl-zebra: color-mix(in oklab, var(--red, #B14340) 4%, #fff);
    --cl-teal-strong: color-mix(in oklab, var(--teal, #548889), #000 28%);
    --cl-hl: color-mix(in oklab, var(--red, #B14340) 10%, #fff);
    --cl-ease: cubic-bezier(.16, 1, .3, 1);
    --cl-ease-out: cubic-bezier(.4, 0, 1, 1);
  }
`;

/** Results list and split lower thirds (shared markup: .graphic > .header + .runner rows) */
export const CLASSIC_MODERN_CSS = `${TOKENS}
  .graphic { border-radius: 14px; box-shadow: 0 22px 44px -14px rgb(0 0 0 / .5), 0 2px 6px rgb(0 0 0 / .18); }
  .graphic.shadow-visible { box-shadow: 0 22px 44px -14px rgb(0 0 0 / .5), 0 2px 6px rgb(0 0 0 / .18); }
  .header {
    height: 76px; font-size: 32px; font-weight: 700; letter-spacing: -.01em; padding-right: 26px;
    transform-origin: 0 50%; transform: scaleX(.92); opacity: 0;
    transition: opacity 360ms var(--cl-ease), transform 620ms var(--cl-ease);
  }
  .header.visible { transform: none; opacity: 1; }
  .header p { margin: 0; }
  .logo { height: 76px; min-width: 96px; }
  .logo img { width: 46px; height: 46px; object-fit: contain; }
  /* logos keep their own transparency unless Settings asks for the white plate */
  .logo:has(> img[data-clear]) { background-color: transparent; }
  .runner {
    font-size: 28px; color: var(--cl-text); min-height: 60px;
    transform: translateY(14px); opacity: 0;
    transition: opacity 420ms var(--cl-ease), transform 560ms var(--cl-ease);
  }
  .runner.visible { transform: none; opacity: 1; }
  .runner:nth-child(even) { background-color: var(--cl-zebra); }
  .runner + .runner { box-shadow: inset 0 1px 0 rgb(0 0 0 / .06); }
  .runner .place { font-size: 28px; font-weight: 800; min-width: 76px; padding: 0 18px; border-right: 3px solid var(--red, #B14340); }
  .runner .name { font-size: 30px; font-weight: 700; padding: 12px 18px; }
  .runner .club { font-size: 24px; font-weight: 500; color: var(--cl-muted); padding: 12px 12px 12px 0; }
  .runner .time {
    width: 170px; font-size: 30px; font-weight: 800; padding: 14px 16px;
    background-color: var(--cl-teal-strong); color: #fff; align-self: stretch;
    display: flex; align-items: center; justify-content: flex-end;
    transform: translateX(24px); opacity: 0;
    transition: opacity 360ms var(--cl-ease) 90ms, transform 520ms var(--cl-ease) 90ms;
  }
  .runner.visible .time { transform: none; opacity: 1; }
  .runner.leader { border-bottom: 3px solid var(--mint, #89B6A5); }
  .runner.leader .time { background-color: var(--mint, #89B6A5); color: var(--cl-text); }
  .runner.selected-live { background-color: var(--cl-hl); }
  .runner.selected-live .time { background-color: #F4C430; color: var(--cl-text); }
  .runner.start-control { font-size: 30px; padding: 0; min-height: 76px; }
  .runner.start-control .name { font-size: 34px; font-weight: 800; }
  .runner.start-control .time { width: 200px; font-size: 34px; }
  .runner.start-control.countdown .time { background-color: #F4C430; color: var(--cl-text); }
  .runner.start-control.countup .time { background-color: #1f7a4a; color: #fff; }
  /* exits: short and accelerating, the whole row leaves together */
  .runner:not(.visible), .runner:not(.visible) .time, .header:not(.visible) {
    transition-duration: 220ms; transition-delay: 0ms; transition-timing-function: var(--cl-ease-out);
  }
  @media (prefers-reduced-motion: reduce) {
    .header, .runner, .runner .time { transform: none !important; transition: opacity 150ms linear !important; }
  }
`;

/** Countdown timer */
export const CLASSIC_TIMER_CSS = `${TOKENS}
  .container { top: 60px; right: 60px; transition: opacity 360ms var(--cl-ease), transform 560ms var(--cl-ease); }
  .container:not(.visible) { transition-duration: 220ms; transition-timing-function: var(--cl-ease-out); }
  .timer-container {
    display: flex; align-items: stretch; min-width: 0; border-radius: 14px; background: #fff;
    box-shadow: 0 22px 44px -14px rgb(0 0 0 / .5), 0 2px 6px rgb(0 0 0 / .18);
  }
  .timer-header { display: flex; align-items: center; padding: 0 22px; font-size: 26px; font-weight: 700; }
  .timer-display { display: flex; }
  .timer-value {
    border-radius: 0; font-size: 46px; font-weight: 800; letter-spacing: 0; padding: 12px 24px;
    min-width: calc(7ch + 48px); color: var(--cl-text); background-color: #F4C430;
  }
  .timer-container.countdown .timer-value { background-color: #F4C430; color: var(--cl-text); }
  .timer-container.countup .timer-value { background-color: var(--cl-teal-strong); color: #fff; }
  .timer-header:empty { display: none; }
`;
