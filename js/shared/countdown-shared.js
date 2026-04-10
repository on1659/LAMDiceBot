// Shared game countdown overlay (3-2-1-START!)
// Used by dice, roulette, and horse-race for unified game-start visual
(function() {
    // Inject keyframes if not already present
    if (!document.getElementById('countdownSharedStyles')) {
        const style = document.createElement('style');
        style.id = 'countdownSharedStyles';
        style.textContent = '@keyframes countPop{0%{transform:scale(.3);opacity:0}50%{transform:scale(1.2);opacity:1}70%{transform:scale(.95)}100%{transform:scale(1);opacity:1}}';
        document.head.appendChild(style);
    }

    /**
     * Show 3-2-1-START! countdown overlay
     * @param {string|null} containerId - DOM id to overlay on (null = full page fixed overlay)
     * @param {Function|null} callback - called after countdown finishes
     */
    window.showGameCountdown = function(containerId, callback) {
        const container = containerId ? document.getElementById(containerId) : null;

        // Remove existing overlay
        const existing = document.getElementById('countdownOverlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'countdownOverlay';
        overlay.style.cssText = container
            ? 'position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.75);z-index:100;display:flex;justify-content:center;align-items:center;font-family:"Segoe UI",Tahoma,Geneva,Verdana,sans-serif;'
            : 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.75);z-index:10000;display:flex;justify-content:center;align-items:center;font-family:"Segoe UI",Tahoma,Geneva,Verdana,sans-serif;';

        if (container) {
            container.style.position = 'relative';
            container.appendChild(overlay);
        } else {
            document.body.appendChild(overlay);
        }

        const nums = ['3', '2', '1', 'START!'];
        const colors = ['var(--red-500)', 'var(--yellow-500)', 'var(--green-500)', 'var(--blue-500)'];
        let idx = 0;

        function showNext() {
            if (idx >= nums.length) {
                overlay.remove();
                if (callback) callback();
                return;
            }
            overlay.innerHTML = '<div style="font-size:' + (nums[idx] === 'START!' ? '60px' : '90px') +
                ';font-weight:900;color:' + colors[idx] +
                ';text-shadow:0 0 30px ' + colors[idx] + ',0 0 60px ' + colors[idx] + '40' +
                ';animation:countPop 0.8s ease-out">' + nums[idx] + '</div>';
            idx++;
            setTimeout(showNext, 1000);
        }
        showNext();
    };
})();
