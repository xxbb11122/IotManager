(() => {
      const overlay = document.getElementById('startup-overlay');
      const app = document.getElementById('app');
      const status = document.getElementById('startup-status');
      const retry = document.getElementById('startup-retry');
      app.inert = true;
      app.setAttribute('aria-hidden', 'true');
      // Anchor pacing before the deferred main module loads. A frame callback
      // is only a paint opportunity, not proof that Android has displayed it.
      window.__iotStartupFirstFrameAt = null;
      requestAnimationFrame((timestamp) => { window.__iotStartupFirstFrameAt = timestamp; });
      const waiting = setTimeout(() => { status.hidden = false; }, 600);
      const showFailure = () => {
        status.textContent = '界面启动未完成，请重新加载。';
        status.hidden = false;
        retry.hidden = false;
      };
      const failed = setTimeout(showFailure, 4000);
      retry.addEventListener('click', () => location.reload());
      window.__iotStartupWatchdog = {
        stop() { clearTimeout(waiting); clearTimeout(failed); },
        fail() { clearTimeout(waiting); clearTimeout(failed); showFailure(); }
      };
    })();
