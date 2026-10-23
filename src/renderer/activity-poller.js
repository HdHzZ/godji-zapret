(function(root) {
  function createActivityPoller({poll, visible, interval = 10000, setTimer = setTimeout, clearTimer = clearTimeout}) {
    let timer = null, running = null, stopped = false;
    function pause() {if(timer !== null){clearTimer(timer);timer = null;}}
    function wake() {
      pause();
      if(stopped || !visible()) return Promise.resolve();
      if(running) return running;
      running = Promise.resolve().then(poll).catch(() => {}).finally(() => {
        running = null;
        if(!stopped && visible()) timer = setTimer(wake,typeof interval === 'function' ? interval() : interval);
      });
      return running;
    }
    return {wake,pause,stop:() => {stopped = true;pause();}};
  }
  if(typeof module !== 'undefined' && module.exports) module.exports = {createActivityPoller};
  else root.createActivityPoller = createActivityPoller;
})(typeof window !== 'undefined' ? window : globalThis);
