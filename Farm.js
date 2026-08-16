javascript:(function(){
    if (window.__farmRunning) return;
    window.__farmRunning = true;

    function debug(msg, color = "#4caf50") {
        let box = document.getElementById("__farmDebug");

        if (!box) {
            box = document.createElement("div");
            box.id = "__farmDebug";
            box.style = `
                position:fixed;
                top:20px;
                right:20px;
                z-index:999999;
                background:#111;
                color:white;
                padding:12px 16px;
                border-radius:8px;
                font-size:14px;
                font-family:Arial;
                box-shadow:0 0 10px rgba(0,0,0,.5);
            `;
            document.body.appendChild(box);
        }

        box.style.border = `2px solid ${color}`;
        box.innerHTML = msg;
    }

    function stop(reason) {
        clearInterval(watcher);
        window.__farmRunning = false;

        debug("STOPPED: " + reason, "#f44336");
        console.log("[FarmGod] Stopped:", reason);
    }

    debug("Farm started...", "#4caf50");

    const watcher = setInterval(function(){
        const $pb = $('#FarmGodProgessbar');

        const current = Number($pb.data('current')) || 0;
        const max = Number($pb.data('max')) || 0;

        debug(`Running... ${current}/${max}`);

        if (current >= max && max > 0) {
            stop(`Reached limit (${current}/${max})`);
            return;
        }

        const $icon = $('.farmGod_icon').first();

        if (!$icon.length) {
            stop("No farm icon found");
            return;
        }

        $icon.trigger('click');

    }, 200 + Math.random() * 50);

    window.addEventListener("beforeunload", function(){
        clearInterval(watcher);
        window.__farmRunning = false;
    });
})();
