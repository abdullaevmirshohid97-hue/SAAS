// Clary desktop — boshlang'ich sahifa.
// Interfeys serverdan (app.clary.uz) yuklanadi: serverga yangi versiya
// joylanganda desktop foydalanuvchilar ham uni darhol oladi ("Yangilash"
// banneri). Bu sahifa faqat internet yo'q holatini chiroyli ko'rsatadi.
(function () {
  var APP_URL = 'https://app.clary.uz/';
  var loading = document.getElementById('loading');
  var offline = document.getElementById('offline');
  var timer = null;

  function show(isOffline) {
    loading.hidden = isOffline;
    offline.hidden = !isOffline;
  }

  function attempt() {
    clearTimeout(timer);
    show(false);
    // no-cors: server javob bersa (opaque) — ochamiz; tarmoq xatosi — offline.
    fetch(APP_URL + 'version.json?ts=' + Date.now(), { mode: 'no-cors', cache: 'no-store' })
      .then(function () {
        window.location.replace(APP_URL);
      })
      .catch(function () {
        show(true);
        timer = setTimeout(attempt, 5000);
      });
  }

  document.getElementById('retry').addEventListener('click', attempt);
  window.addEventListener('online', attempt);
  attempt();
})();
