/* Keep DOM action targets stable while the reader touches or scrolls the board. */
window.ZeroInteractionHold = {
  create({release, changed = () => {}, schedule = setTimeout, cancel = clearTimeout}) {
    let held = false, hovering = false, timer = null;
    const pointers = new Set();
    function clear() { if (timer != null) cancel(timer); timer = null; }
    function hold() { clear(); held = true; changed(true); }
    function countdown() {
      clear();
      if (pointers.size || hovering) return;
      timer = schedule(() => { timer = null; held = false; changed(false); release(); }, 5000);
    }
    return {
      held: () => held,
      down(id) { pointers.add(id); hold(); },
      up(id) { pointers.delete(id); if (held) countdown(); },
      hover(value) { hovering = value; if (value) hold(); else if (held) countdown(); },
      scroll() { hold(); countdown(); },
      activity() { hold(); countdown(); },
      reset() { clear(); pointers.clear(); hovering = false; held = false; changed(false); }
    };
  }
};
