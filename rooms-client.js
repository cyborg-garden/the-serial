/**
 * rooms-client.js — the browser half of arcade-rooms. Copy this file into a
 * game; it has no dependencies and defines one global, ArcadeRooms.
 *
 *   var room = ArcadeRooms.connect('ship-names', {
 *     name: 'Ana',
 *     onView: function (msg) { ... },     // { you, players, v }
 *     onStatus: function (status) { ... } // 'connecting' | 'open' | 'closed'
 *     onError: function (text) { ... }
 *   });
 *   room.send({ type: 'vote', for: 3 });
 *   room.close();
 *
 * Which room: inside a Discord Activity everyone in the same launch shares
 * Discord's instance id, so they land together with no setup. Anywhere else
 * the room is the ?room= code in the address, and ArcadeRooms.inviteLink()
 * gives a link to share.
 *
 * Where the server is: inside Discord it is this same host under /rt (a URL
 * mapping in the developer portal). Otherwise window.ARCADE_ROOMS_URL, which
 * a game sets in its own config.js, or this host when running locally.
 */
(function () {
  function param(name) {
    var places = [window];
    // The arcade picker holds a game in a frame; Discord's launch details are
    // on the picker's address, one level up and on the same origin.
    try { if (window.parent !== window) places.push(window.parent); } catch (e) {}
    for (var i = 0; i < places.length; i++) {
      try {
        var value = new URLSearchParams(places[i].location.search).get(name);
        if (value) return value;
      } catch (e) {}
    }
    return null;
  }

  function inDiscord() {
    return /\.discordsays\.com$/.test(location.hostname);
  }

  function store(key, make) {
    try {
      var had = localStorage.getItem(key);
      if (had) return had;
      var fresh = make();
      localStorage.setItem(key, fresh);
      return fresh;
    } catch (e) {
      return make();
    }
  }

  function randomId(length) {
    var alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
    var bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    var out = '';
    for (var i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
    return out;
  }

  var roomId = null;
  function room() {
    if (roomId) return roomId;
    var raw = param('instance_id') || param('room');
    if (raw && /^[A-Za-z0-9_-]{1,80}$/.test(raw)) {
      roomId = raw;
    } else {
      roomId = randomId(6);
      // Put the code in the address so a reload, or a copied link, comes back
      // to the same room.
      try {
        var url = new URL(location.href);
        url.searchParams.set('room', roomId);
        history.replaceState(null, '', url);
      } catch (e) {}
    }
    return roomId;
  }

  function base() {
    if (inDiscord()) return 'wss://' + location.host;
    if (window.ARCADE_ROOMS_URL) return String(window.ARCADE_ROOMS_URL).replace(/\/$/, '');
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
  }

  function connect(game, options) {
    var id = store('arcade-rooms-id', function () { return randomId(20); });
    var socket = null;
    var closed = false;
    var wait = 500;
    var name = options.name;

    function status(s) { if (options.onStatus) options.onStatus(s); }

    function open() {
      if (closed) return;
      status('connecting');
      socket = new WebSocket(base() + '/rt/' + game + '/' + room());
      socket.onopen = function () {
        wait = 500;
        socket.send(JSON.stringify({ t: 'hello', id: id, name: name }));
        status('open');
      };
      socket.onmessage = function (event) {
        var msg;
        try { msg = JSON.parse(event.data); } catch (e) { return; }
        if (msg.t === 'view' && options.onView) options.onView(msg);
        if (msg.t === 'error' && options.onError) options.onError(msg.m);
      };
      socket.onclose = function (event) {
        status('closed');
        // 4000: this player opened the game in another tab, which now owns it.
        if (closed || event.code === 4000) return;
        setTimeout(open, wait);
        wait = Math.min(wait * 2, 8000);
      };
    }
    open();

    return {
      id: id,
      send: function (data) {
        if (socket && socket.readyState === 1) socket.send(JSON.stringify({ t: 'msg', d: data }));
      },
      rename: function (next) {
        name = next;
        if (socket && socket.readyState === 1) socket.send(JSON.stringify({ t: 'hello', id: id, name: name }));
      },
      close: function () { closed = true; if (socket) socket.close(); },
    };
  }

  window.ArcadeRooms = {
    connect: connect,
    inDiscord: inDiscord,
    room: room,
    inviteLink: function () {
      var url = new URL(location.href);
      url.searchParams.set('room', room());
      return url.toString();
    },
    savedName: function () {
      try { return localStorage.getItem('arcade-rooms-name') || ''; } catch (e) { return ''; }
    },
    saveName: function (value) {
      try { localStorage.setItem('arcade-rooms-name', value); } catch (e) {}
    },
  };
})();
