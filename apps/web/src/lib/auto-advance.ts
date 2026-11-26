/** How long the card centre stays in the screen-centre band before the slider moves (plan §10.1 A14). */
export const AUTO_ADVANCE_MS = 3000;

/**
 * The auto-advance of a card slider: `band(true)` starts the wait, `band(false)` before the end
 * cancels it, and `advance` runs at most once. `stop()` (any rider input) ends it for good.
 */
export function autoAdvance(advance: () => void, ms = AUTO_ADVANCE_MS) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let done = false;
  const clear = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  return {
    band(inside: boolean) {
      if (done) return;
      if (!inside) return clear();
      timer ??= setTimeout(() => {
        done = true;
        timer = undefined;
        advance();
      }, ms);
    },
    stop() {
      done = true;
      clear();
    },
  };
}
