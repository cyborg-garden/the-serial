/**
 * game.js — the browser side of The Serial.
 *
 * The server sends each player a `view` (see arcade-rooms/games/the-serial/
 * logic.mjs) and this file draws it. It never knows the script: only the
 * current scene, and only the lines that have aired. A player's own seat is
 * msg.you; the secret key that holds it stays inside rooms-client.js. All text goes in with
 * textContent, and there is no inline script anywhere (Discord blocks it).
 */
(function () {
  'use strict';

  var GAME = 'the-serial';
  var SVG_NS = 'http://www.w3.org/2000/svg';

  // ------------------------------------------------------------ dom helpers

  function $(id) { return document.getElementById(id); }

  function add(node, kids) {
    if (!kids) return node;
    for (var i = 0; i < kids.length; i++) {
      var kid = kids[i];
      if (kid === null || kid === undefined || kid === false) continue;
      node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    }
    return node;
  }

  function el(tag, props, kids) {
    var node = document.createElement(tag);
    for (var key in props || {}) {
      var value = props[key];
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'on') { for (var name in value) node.addEventListener(name, value[name]); }
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    return add(node, kids);
  }

  function svg(tag, attrs, kids) {
    var node = document.createElementNS(SVG_NS, tag);
    for (var key in attrs || {}) node.setAttribute(key, String(attrs[key]));
    return add(node, kids);
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function now() { return Date.now(); }

  // ------------------------------------------------------------------ state

  var app = $('app');
  var screen = $('screen');
  var visor = $('visor');
  var alertBox = $('alert');
  var crewList = $('crew');
  var live = $('live');

  var room = null;
  var latest = null; // the last { you, players, v } from the server
  var myName = '';
  var joinError = '';
  var elsewhere = false;
  var ui = {}; // elements and keys of whatever is on screen now
  var task = { down: false, downAt: 0, value: '', dial: 0 };

  function announce(text) { live.textContent = text; }
  function send(data) { if (room) room.send(data); }

  // --------------------------------------------------------- countdown bars

  function bar(className) {
    var fill = el('span', { class: 'bar-fill' });
    var wrap = el('span', { class: 'bar' + (className ? ' ' + className : ''), 'aria-hidden': 'true' }, [fill]);
    wrap.fill = fill;
    return wrap;
  }

  function setBar(fill, msLeft, totalMs) {
    fill.timing = { left: msLeft, total: totalMs || 1, at: now() };
    paintBar(fill);
  }

  function paintBar(fill) {
    var t = fill.timing;
    if (!t) return;
    var left = Math.max(0, t.left - (now() - t.at));
    fill.style.transform = 'scaleX(' + Math.min(1, left / t.total).toFixed(3) + ')';
  }

  setInterval(function () {
    if (ui.voteFill) paintBar(ui.voteFill);
    if (ui.alertFill) paintBar(ui.alertFill);
    if (ui.visorFill) paintBar(ui.visorFill);
    if (ui.holdFill) {
      var part = task.down ? Math.min(1, (now() - task.downAt) / (ui.holdMs || 1)) : 0;
      ui.holdFill.style.transform = 'scaleX(' + part.toFixed(3) + ')';
    }
    if (ui.noteUntil && now() > ui.noteUntil) {
      ui.noteUntil = 0;
      if (latest) renderAlert(latest.v);
    }
  }, 150);

  // ------------------------------------------------------------- the screen

  function setMode(mode, build) {
    if (screen.getAttribute('data-mode') === mode) return false;
    clear(screen);
    screen.setAttribute('data-mode', mode);
    ui.sceneKey = '';
    ui.ballotKey = '';
    ui.voteFill = null;
    ui.endKey = '';
    build();
    return true;
  }

  function renderJoin() {
    setMode('join', function () {
      var input = el('input', {
        id: 'name', type: 'text', maxlength: 24, autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false',
      });
      input.value = window.ArcadeRooms ? window.ArcadeRooms.savedName() : '';
      ui.joinError = el('p', { class: 'error', role: 'alert' });
      var form = el('form', { class: 'join-form', novalidate: true, on: { submit: function (event) {
        event.preventDefault();
        var name = input.value.replace(/\s+/g, ' ').trim().slice(0, 24);
        if (!name) {
          ui.joinError.textContent = 'Type a name first.';
          input.focus();
          return;
        }
        join(name);
      } } }, [
        el('label', null, ['Your name', input]),
        el('button', { class: 'btn-main', type: 'submit', text: 'Join the crew' }),
      ]);
      add(screen, [el('div', { class: 'card' }, [
        el('h1', { text: 'The Serial' }),
        el('p', { class: 'lead', text: 'You are on the night shift at Marrowlight Station. Your show is on.' }),
        form,
        ui.joinError,
      ])]);
    });
    ui.joinError.textContent = joinError;
  }

  function renderLinking() {
    setMode('linking', function () {
      add(screen, [el('div', { class: 'card' }, [
        el('h2', { text: 'Clocking in' }),
        el('p', { text: 'This usually takes a moment.' }),
      ])]);
    });
  }

  function renderLobby(v) {
    setMode('lobby', function () {
      ui.lobbyCrew = el('p', { class: 'lead' });
      var buttons = [el('button', { class: 'btn-main', type: 'button', text: 'Start the episode', on: { click: function () {
        send({ type: 'start' });
      } } })];
      var inviteRow = null;
      if (!window.ArcadeRooms.inDiscord()) {
        var copy = el('button', { class: 'btn-quiet', type: 'button', text: 'Copy invite link' });
        inviteRow = el('div', { class: 'row' });
        copy.addEventListener('click', function () {
          var link = window.ArcadeRooms.inviteLink();
          var fallback = function () {
            clear(inviteRow);
            var field = el('input', { class: 'invite-link', type: 'text', readonly: true, 'aria-label': 'Invite link' });
            field.value = link;
            inviteRow.appendChild(field);
            field.focus();
            field.select();
          };
          try {
            navigator.clipboard.writeText(link).then(function () {
              copy.textContent = 'Link copied';
              announce('Invite link copied.');
            }, fallback);
          } catch (error) {
            fallback();
          }
        });
        buttons.push(copy);
      }
      add(screen, [el('div', { class: 'card' }, [
        el('h2', { text: 'On tonight: ' + v.show }),
        el('ul', { class: 'rules' }, [
          el('li', { text: 'The show plays for the whole shift. After each scene, vote on what happens next.' }),
          el('li', { text: 'Job tickets will ring. Respond, and your work tablet covers the show until the job is done.' }),
          el('li', { text: 'Let one ring out and the shift rating drops. Your call.' }),
        ]),
        ui.lobbyCrew,
        el('div', { class: 'row' }, buttons),
        inviteRow,
      ])]);
    });
    var names = v.crew.map(function (c) { return c.name; });
    ui.lobbyCrew.textContent = names.length === 1
      ? 'Only you so far. You can start alone, or wait for the others.'
      : 'On shift: ' + names.join(', ') + '. Anyone can start.';
  }

  // ---------------------------------------------------------------- figures

  function figure(member) {
    var look = member.look || {};
    var parts = [];
    if (look.body === 'gown') {
      parts.push(svg('path', { class: 'fig-body', d: 'M50 50 C38 50 33 60 31 76 L14 158 L86 158 L69 76 C67 60 62 50 50 50 Z' }));
      parts.push(svg('path', { class: 'fig-shade', d: 'M35 84 L65 84 L68 96 L32 96 Z' }));
    } else if (look.body === 'bot') {
      parts.push(svg('rect', { class: 'fig-body', x: 24, y: 62, width: 52, height: 68, rx: 10 }));
      parts.push(svg('rect', { class: 'fig-shade', x: 34, y: 84, width: 32, height: 20, rx: 3 }));
      parts.push(svg('rect', { class: 'fig-shade', x: 45, y: 54, width: 10, height: 9 }));
      [32, 50, 68].forEach(function (cx) { parts.push(svg('circle', { class: 'fig-shade', cx: cx, cy: 144, r: 10 })); });
    } else {
      if (look.body === 'cape') parts.push(svg('path', { class: 'fig-shade', d: 'M20 62 Q50 42 80 62 L96 158 L4 158 Z' }));
      parts.push(svg('path', { class: 'fig-body', d: look.body === 'cape' ? 'M32 66 Q50 54 68 66 L71 158 L29 158 Z' : 'M26 66 Q50 48 74 66 L78 158 L22 158 Z' }));
      parts.push(svg('path', { class: 'fig-shade', d: 'M50 58 L41 61 L50 96 L59 61 Z' }));
      parts.push(svg('circle', { class: 'fig-trim', cx: 50, cy: look.body === 'cape' ? 62 : 110, r: look.body === 'cape' ? 4 : 2.5 }));
    }
    if (look.hat === 'veil') parts.push(svg('path', { class: 'fig-veil', d: 'M33 30 Q50 4 67 30 L80 98 Q50 86 20 98 Z' }));
    if (look.body === 'bot') {
      parts.push(svg('rect', { class: 'fig-head', x: 30, y: 24, width: 40, height: 32, rx: 8 }));
      parts.push(svg('circle', { class: 'fig-lens', cx: 50, cy: 40, r: 9 }));
      parts.push(svg('circle', { class: 'fig-glint', cx: 53, cy: 37, r: 3 }));
    } else {
      parts.push(svg('rect', { class: 'fig-head', x: 45, y: 42, width: 10, height: 12 }));
      parts.push(svg('circle', { class: 'fig-head', cx: 50, cy: 32, r: 15 }));
    }
    if (look.hat === 'brim') {
      parts.push(svg('ellipse', { class: 'fig-shade', cx: 50, cy: 21, rx: 34, ry: 7 }));
      parts.push(svg('path', { class: 'fig-body', d: 'M34 21 Q50 -1 66 21 Z' }));
      parts.push(svg('path', { class: 'fig-trim', d: 'M63 14 Q84 1 81 22 Q76 12 63 14 Z' }));
    } else if (look.hat === 'veil') {
      parts.push(svg('path', { class: 'fig-trim', d: 'M38 21 L44 12 L50 19 L56 12 L62 21 Z' }));
    } else if (look.hat === 'cap') {
      parts.push(svg('path', { class: 'fig-shade', d: 'M33 25 Q50 4 67 25 Z' }));
      parts.push(svg('rect', { class: 'fig-trim', x: 33, y: 23, width: 39, height: 4, rx: 2 }));
    } else if (look.hat === 'topper') {
      parts.push(svg('rect', { class: 'fig-shade', x: 38, y: 0, width: 24, height: 21, rx: 2 }));
      parts.push(svg('rect', { class: 'fig-shade', x: 29, y: 19, width: 42, height: 5, rx: 2 }));
      parts.push(svg('rect', { class: 'fig-trim', x: 38, y: 13, width: 24, height: 4 }));
    } else if (look.hat === 'antenna') {
      parts.push(svg('path', { class: 'fig-line', d: 'M50 24 L50 9' }));
      parts.push(svg('circle', { class: 'fig-trim', cx: 50, cy: 7, r: 4 }));
    }
    var hue = /^[a-z]+$/.test(look.hue || '') ? look.hue : 'silver';
    var wrap = el('div', { class: 'fig hue-' + hue }, [
      svg('svg', { viewBox: '0 -4 100 164', preserveAspectRatio: 'xMidYMax meet', 'aria-hidden': 'true', focusable: 'false' }, parts),
    ]);
    wrap.castId = member.id;
    return wrap;
  }

  // ---------------------------------------------------------------- the show

  function lineNode(line, hues, fresh) {
    if (line.missed) return el('p', { class: 'line missed', text: 'Missed. You were working.' });
    if (line.who === 'stage') return el('p', { class: 'line stage-note' + (fresh ? ' fresh' : ''), text: line.text });
    var hue = hues[line.who];
    var node = el('p', { class: 'line' + (line.who === 'announcer' ? ' announcer' : '') + (hue ? ' hue-' + hue : '') + (fresh ? ' fresh' : '') }, [
      el('span', { class: 'speaker', text: line.name }),
      el('span', { text: line.text }),
    ]);
    return node;
  }

  function renderShow(v) {
    var s = v.scene;
    setMode('show', function () {
      ui.bugTitle = el('span', { class: 'bug-title' });
      ui.bugCount = el('span', { class: 'bug-count' });
      ui.stage = el('div', { class: 'stage', role: 'img' });
      ui.captions = el('div', { class: 'captions', role: 'log', 'aria-live': 'polite', 'aria-label': 'Captions' });
      ui.ballot = el('div', { class: 'ballot' });
      add(screen, [el('div', { class: 'broadcast' }, [
        el('div', { class: 'bug' }, [el('span', { class: 'bug-show', text: v.show }), ui.bugTitle, ui.bugCount]),
        ui.stage,
        el('div', { class: 'side' }, [ui.captions, ui.ballot]),
      ])]);
    });

    var sceneKey = v.round + ':' + s.number;
    if (ui.sceneKey !== sceneKey) {
      ui.sceneKey = sceneKey;
      ui.bugTitle.textContent = s.title;
      ui.bugCount.textContent = (s.finale ? 'Finale' : 'Scene ' + s.number) + ' of ' + s.of;
      clear(ui.stage);
      ui.stage.setAttribute('data-backdrop', /^[a-z]+$/.test(s.backdrop || '') ? s.backdrop : 'ring');
      ui.stage.setAttribute('aria-label', 'On stage: ' + s.cast.map(function (c) { return c.name; }).join(', '));
      ui.stage.appendChild(el('span', { class: 'stage-place', text: s.place }));
      ui.hues = {};
      ui.figs = s.cast.map(function (member) {
        ui.hues[member.id] = member.look && /^[a-z]+$/.test(member.look.hue || '') ? member.look.hue : '';
        var fig = figure(member);
        ui.stage.appendChild(fig);
        return fig;
      });
      clear(ui.captions);
      ui.lineCount = 0;
      ui.titleCard = el('div', { class: 'title-card' }, [
        el('p', { class: 'tc-title', text: s.title }),
        el('p', { class: 'tc-place', text: s.place }),
      ]);
      ui.captions.appendChild(ui.titleCard);
    }

    if (s.lines.length < ui.lineCount) {
      clear(ui.captions);
      ui.lineCount = 0;
      ui.titleCard = null;
    }
    if (s.lines.length > ui.lineCount) {
      if (ui.titleCard) {
        ui.captions.removeChild(ui.titleCard);
        ui.titleCard = null;
      }
      var fresh = s.lines.length - ui.lineCount === 1;
      for (var i = ui.lineCount; i < s.lines.length; i++) ui.captions.appendChild(lineNode(s.lines[i], ui.hues, fresh));
      ui.lineCount = s.lines.length;
    }
    var lastLine = s.lines[s.lines.length - 1];
    var speaker = lastLine && !lastLine.missed ? lastLine.who : null;
    ui.figs.forEach(function (fig) { fig.classList.toggle('speaking', fig.castId === speaker); });

    renderBallot(v, sceneKey);
  }

  function renderBallot(v, sceneKey) {
    if (v.vote) {
      var key = 'vote:' + sceneKey + ':' + (v.vote.mine || '');
      if (ui.ballotKey !== key) {
        var hadFocus = ui.ballot.contains(document.activeElement);
        ui.ballotKey = key;
        clear(ui.ballot);
        ui.voteCount = el('span', { class: 'ballot-count' });
        var timer = bar();
        ui.voteFill = timer.fill;
        var mine = v.vote.mine;
        var options = v.vote.options.map(function (option, index) {
          var button = el('button', {
            class: 'option', type: 'button', disabled: mine ? true : null,
            'aria-pressed': mine === option.id ? 'true' : 'false',
            on: { click: function () { send({ type: 'vote', option: option.id }); } },
          }, [el('span', { class: 'key', 'aria-hidden': 'true', text: String(index + 1) }), el('span', { text: option.label })]);
          return button;
        });
        add(ui.ballot, [
          el('div', { class: 'ballot-head' }, [el('p', { class: 'ballot-prompt', text: v.vote.prompt }), ui.voteCount]),
          timer,
          el('div', { class: 'options' }, options),
        ]);
        if (!mine) announce('Vote now. ' + v.vote.prompt);
        else if (hadFocus) screen.focus();
      }
      ui.voteCount.textContent = (v.vote.mine ? 'Vote sent. ' : '') + v.vote.voted + ' of ' + v.vote.of + ' voted';
      setBar(ui.voteFill, v.vote.msLeft, v.vote.totalMs);
    } else if (v.result) {
      var resultKey = 'result:' + sceneKey;
      if (ui.ballotKey !== resultKey) {
        ui.ballotKey = resultKey;
        ui.voteFill = null;
        clear(ui.ballot);
        var counts = v.result.counts || {};
        var total = 0;
        for (var id in counts) total += counts[id];
        var note = total === 0 ? 'Nobody voted. The writers chose.'
          : v.result.tie ? 'A tied vote, settled by a coin toss.'
          : counts[v.result.id] + ' of ' + total + (total === 1 ? ' vote.' : ' votes.');
        add(ui.ballot, [
          el('p', { class: 'ballot-prompt', text: v.result.prompt }),
          el('p', { class: 'result-label', text: v.result.label }),
          el('p', { class: 'result-note', text: note }),
        ]);
        announce('The room chose: ' + v.result.label);
      }
    } else if (ui.ballotKey) {
      ui.ballotKey = '';
      ui.voteFill = null;
      clear(ui.ballot);
    }
  }

  function renderCovered() {
    setMode('covered', function () {
      add(screen, [el('div', { class: 'covered-note', text: 'Work tablet up.' })]);
    });
  }

  // ----------------------------------------------------------------- the end

  function renderEnd(msg) {
    var v = msg.v;
    var end = v.end;
    var key = 'end:' + v.round;
    setMode('end', function () {});
    if (ui.endKey === key) return;
    ui.endKey = key;
    clear(screen);
    var rows = end.crew.map(function (row) {
      var calls = row.handled + row.botched + row.ignored;
      var detail = calls === 0 ? 'No jobs.' : 'Jobs: ' + row.handled + ' handled, ' + row.botched + ' botched, ' + row.ignored + ' ignored.';
      return el('li', { class: row.id === msg.you ? 'me' : null }, [
        el('span', { class: 'end-who', text: row.name }),
        el('span', { class: 'end-pct', text: (row.watched === null ? 0 : row.watched) + '% watched' }),
        el('span', { class: 'end-verdict', text: row.verdict + ' ' + detail }),
      ]);
    });
    var choices = end.choices.map(function (c) { return el('li', { text: c.scene + ': ' + c.label }); });
    add(screen, [el('div', { class: 'end' }, [
      el('div', { class: 'end-col' }, [
        el('p', { class: 'end-kicker', text: v.show + ', the finale' }),
        el('h2', { text: end.finale.title }),
        el('p', { class: 'end-summary', text: end.finale.summary }),
        el('p', { class: 'end-rating' }, [
          el('span', { text: 'Shift rating' }),
          el('strong', { text: String(end.rating) }),
          el('span', { text: end.ratingNote }),
        ]),
        el('div', { class: 'row' }, [
          el('button', { class: 'btn-main', type: 'button', text: 'Watch again', on: { click: function () {
            send({ type: 'again' });
          } } }),
        ]),
      ]),
      el('div', { class: 'end-col' }, [
        el('p', { class: 'end-kicker', text: 'Episode watched' }),
        el('ul', { class: 'end-list' }, rows),
        el('details', null, [
          el('summary', { text: 'How the room voted' }),
          el('ol', { class: 'end-choices' }, choices),
        ]),
        // The staff badge: signed by the rooms server, so it cannot be made
        // here. Crews bring theirs to the green room on cyborg.garden.
        typeof v.code === 'string' ? el('div', { class: 'end-badge' }, [
          el('p', { class: 'end-kicker', text: 'Staff badge' }),
          el('p', { class: 'end-code', text: v.code }),
          el('p', { class: 'end-where', text: 'cyborg.garden/green-room' }),
        ]) : null,
      ]),
    ])]);
    announce('The end. ' + end.finale.title + '. Shift rating ' + end.rating + '.');
  }

  // ---------------------------------------------------------- the work tablet

  function taskButton(label, keyHint, onClick, extra) {
    return el('button', { class: 'task-btn' + (extra ? ' ' + extra : ''), type: 'button', on: { click: onClick } }, [
      keyHint ? el('span', { class: 'key', 'aria-hidden': 'true', text: keyHint }) : null,
      el('span', { text: label }),
    ]);
  }

  function answer(value) { send({ type: 'answer', value: value }); }

  function holdDown() {
    if (task.down) return;
    task.down = true;
    task.downAt = now();
    send({ type: 'hold', down: true });
    if (ui.holdBtn) {
      ui.holdBtn.classList.add('down');
      ui.holdLabel.textContent = 'Holding. Keep holding.';
    }
  }

  function holdUp() {
    if (!task.down) return;
    task.down = false;
    send({ type: 'hold', down: false });
    if (ui.holdBtn) {
      ui.holdBtn.classList.remove('down');
      ui.holdLabel.textContent = 'Press and hold';
    }
  }

  function codeType(digit) {
    if (task.value.length >= 4) return;
    task.value += digit;
    ui.entry.textContent = task.value;
  }
  function codeClear() {
    task.value = '';
    ui.entry.textContent = '';
  }
  function codeSend() { if (task.value.length > 0) answer(task.value); }
  function dialStep(by) {
    task.dial = Math.max(0, Math.min(999, task.dial + by));
    ui.dialValue.textContent = String(task.dial);
  }

  // Builds the controls for a task and sets ui.taskFocus to the control that
  // should take focus: the one where Enter does the sensible thing.
  function buildTask(em) {
    ui.taskFocus = null;
    if (em.kind === 'pick') {
      return [el('div', { class: 'task-options' }, em.options.map(function (text, index) {
        return taskButton(text, String(index + 1), function () { answer(index); });
      }))];
    }
    if (em.kind === 'scan') {
      var marks = [
        svg('circle', { class: 'scope-ring', cx: 50, cy: 50, r: 49 }),
        svg('circle', { class: 'scope-grid', cx: 50, cy: 50, r: 32 }),
        svg('circle', { class: 'scope-grid', cx: 50, cy: 50, r: 16 }),
        svg('path', { class: 'scope-grid', d: 'M50 1 V99 M1 50 H99' }),
      ];
      // The server lays blips on a 100 by 100 square; pull them inside the ring.
      em.blips.forEach(function (b) {
        marks.push(svg('circle', { class: 'scope-blip', cx: 50 + (b.x - 50) * 0.66, cy: 50 + (b.y - 50) * 0.66, r: 3.2 }));
      });
      return [el('div', { class: 'scan' }, [
        svg('svg', { class: 'scope', viewBox: '0 0 100 100', role: 'img', 'aria-label': 'Scope showing ' + em.blips.length + ' blips' }, marks),
        el('div', { class: 'task-row' }, em.choices.map(function (n, index) {
          return taskButton(String(n), String(index + 1), function () { answer(n); });
        })),
      ])];
    }
    if (em.kind === 'code') {
      task.value = '';
      ui.entry = el('div', { class: 'readout entry', 'aria-live': 'polite' });
      var digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map(function (d) {
        return taskButton(d, null, function () { codeType(d); });
      });
      return [
        el('div', { class: 'code-grid' }, [
          el('div', { class: 'code-cols' }, [el('span', { class: 'readout-label', text: 'Panel shows' }), el('div', { class: 'readout', text: em.code })]),
          el('div', { class: 'code-cols' }, [el('span', { class: 'readout-label', text: 'You entered' }), ui.entry]),
        ]),
        el('div', { class: 'keypad' }, digits),
        el('div', { class: 'task-row' }, [
          taskButton('Clear', null, codeClear),
          (ui.taskFocus = taskButton('Send', null, codeSend, 'task-go')),
        ]),
      ];
    }
    if (em.kind === 'dial') {
      task.dial = em.from;
      ui.dialValue = el('div', { class: 'readout entry', 'aria-live': 'polite', text: String(em.from) });
      return [
        el('span', { class: 'readout-label', text: 'Wanted: ' + em.target + ' ' + em.unit }),
        el('div', { class: 'dial' }, [
          el('button', { class: 'task-btn', type: 'button', 'aria-label': 'Down one', text: '−', on: { click: function () { dialStep(-1); } } }),
          ui.dialValue,
          el('button', { class: 'task-btn', type: 'button', 'aria-label': 'Up one', text: '+', on: { click: function () { dialStep(1); } } }),
        ]),
        (ui.taskFocus = taskButton('Set', null, function () { answer(task.dial); }, 'task-go')),
      ];
    }
    // hold
    ui.holdMs = em.holdMs;
    ui.holdLabel = el('span', { text: 'Press and hold' });
    var holdBar = bar('hold-bar');
    ui.holdFill = holdBar.fill;
    ui.holdBtn = el('button', { class: 'hold-btn', type: 'button', on: {
      pointerdown: function (event) {
        try { ui.holdBtn.setPointerCapture(event.pointerId); } catch (error) {}
        holdDown();
      },
      pointerup: holdUp,
      pointercancel: holdUp,
      lostpointercapture: holdUp,
      blur: holdUp,
      contextmenu: function (event) { event.preventDefault(); },
      keydown: function (event) {
        if (event.key !== ' ' && event.key !== 'Enter') return;
        event.preventDefault();
        if (!event.repeat) holdDown();
      },
      keyup: function (event) {
        if (event.key !== ' ' && event.key !== 'Enter') return;
        event.preventDefault();
        holdUp();
      },
    } }, [ui.holdLabel]);
    return [ui.holdBtn, holdBar];
  }

  function renderVisor(v) {
    var em = v.emergency;
    var open = !!em && em.state === 'open';
    visor.classList.toggle('open', open);
    if (open) screen.setAttribute('inert', '');
    else screen.removeAttribute('inert');

    if (!open) {
      if (ui.visorKey) {
        ui.visorKey = '';
        task.down = false;
        ui.visorFill = null;
        ui.holdFill = null;
        ui.holdBtn = null;
        if (visor.contains(document.activeElement)) screen.focus();
      }
      return;
    }

    var key = v.round + ':' + em.n;
    if (ui.visorKey !== key) {
      ui.visorKey = key;
      task.down = false;
      ui.holdFill = null;
      ui.holdBtn = null;
      clear(visor);
      var timer = bar();
      ui.visorFill = timer.fill;
      var body = el('div', { class: 'visor-body' }, [el('p', { class: 'visor-prompt', text: em.prompt })].concat(buildTask(em)));
      add(visor, [
        el('div', { class: 'visor-head' }, [
          el('span', { class: 'visor-kicker', text: 'Job ticket' }),
          el('h2', { class: 'visor-title', text: em.title }),
          timer,
        ]),
        body,
        el('p', { class: 'visor-foot', text: 'The show is still playing behind this.' }),
      ]);
      var first = ui.taskFocus || body.querySelector('button');
      if (first) first.focus();
      announce(em.prompt);
    }
    setBar(ui.visorFill, em.msLeft, em.totalMs);
    // If the server never heard the press, say it again.
    if (em.kind === 'hold' && task.down && !em.holding) send({ type: 'hold', down: true });
  }

  var NOTES = {
    handled: 'Job done. Back to the show.',
    botched: 'Wrong fix. The front desk noticed.',
    ignored: 'Ticket rang out. Shift rating dropped.',
  };

  function renderAlert(v) {
    var em = v.emergency;
    var last = v.me && v.me.last;
    var lastKey = last ? v.round + ':' + last.n : '';
    if (ui.lastKey === undefined) ui.lastKey = lastKey;
    if (lastKey !== ui.lastKey) {
      ui.lastKey = lastKey;
      if (last && NOTES[last.result]) {
        ui.note = last.result;
        ui.noteUntil = now() + 5000;
        announce(NOTES[last.result]);
      }
    }

    var key = '';
    if (em && em.state === 'ringing') key = 'ring:' + v.round + ':' + em.n;
    else if (ui.noteUntil && (!em || em.state !== 'open')) key = 'note:' + ui.lastKey;
    if (ui.alertKey !== key) {
      var hadFocus = alertBox.contains(document.activeElement);
      ui.alertKey = key;
      ui.alertFill = null;
      clear(alertBox);
      if (key.indexOf('ring:') === 0) {
        var timer = bar();
        ui.alertFill = timer.fill;
        add(alertBox, [el('div', { class: 'alert-box' }, [
          el('div', { class: 'alert-text' }, [el('span', { class: 'alert-title', text: 'Job ticket: ' + em.title }), timer]),
          el('button', { class: 'btn-respond', type: 'button', 'aria-keyshortcuts': 'r', on: { click: function () { send({ type: 'respond' }); } } }, [
            'Respond', el('kbd', { 'aria-hidden': 'true', text: 'R' }),
          ]),
        ])]);
        announce('Job ticket: ' + em.title + '. Respond, or let it ring.');
      } else if (key) {
        add(alertBox, [el('span', { class: 'alert-note', 'data-result': ui.note, text: NOTES[ui.note] })]);
      }
      if (hadFocus && !visor.classList.contains('open')) screen.focus();
    }
    if (ui.alertFill && em) setBar(ui.alertFill, em.msLeft, em.totalMs);
  }

  // ------------------------------------------------------------------ the hud

  function renderHud(msg) {
    var v = msg.v;
    $('unit').textContent = myName ? 'Fixer: ' + myName : '';
    var rating = Math.max(0, Math.min(100, Number(v.rating) || 0));
    $('rating-num').textContent = String(rating);
    $('rating-fill').style.transform = 'scaleX(' + (rating / 100).toFixed(2) + ')';
    $('rating').setAttribute('aria-valuenow', String(rating));
    $('rating').setAttribute('data-level', rating >= 70 ? 'ok' : rating >= 40 ? 'mid' : 'low');
    var watched = v.me ? v.me.watched : null;
    $('watched').textContent = watched === null || watched === undefined ? '--' : watched + '%';

    var key = v.phase + JSON.stringify(v.crew);
    if (ui.crewKey === key) return;
    ui.crewKey = key;
    clear(crewList);
    v.crew.forEach(function (member) {
      var state = !member.connected ? 'away'
        : member.busy ? 'working'
        : v.phase === 'lobby' ? 'ready'
        : v.phase === 'ended' ? 'done'
        : member.voted ? 'voted' : 'watching';
      crewList.appendChild(el('li', { 'data-state': state, class: member.id === msg.you ? 'me' : null }, [
        el('span', { class: 'tick', 'aria-hidden': 'true' }),
        el('span', { class: 'who', text: member.name }),
        el('span', { class: 'what', text: state }),
      ]));
    });
  }

  // -------------------------------------------------------------------- render

  function renderElsewhere() {
    setMode('elsewhere', function () {
      add(screen, [el('div', { class: 'card' }, [
        el('h2', { text: 'Open in another tab' }),
        el('p', { class: 'lead', text: 'Your place on the shift is open in another tab or window. Carry on there, or reload this page to bring it back here.' }),
      ])]);
    });
    visor.classList.remove('open');
    screen.removeAttribute('inert');
    clear(alertBox);
    ui.alertKey = '';
  }

  function render() {
    if (elsewhere) {
      renderElsewhere();
      return;
    }
    if (!latest) {
      app.setAttribute('data-phase', 'join');
      if (room) renderLinking();
      else renderJoin();
      return;
    }
    var v = latest.v;
    app.setAttribute('data-phase', v.phase);
    renderHud(latest);
    if (v.phase === 'lobby') renderLobby(v);
    else if (v.phase === 'ended') renderEnd(latest);
    else if (v.cover || !v.scene) renderCovered();
    else renderShow(v);
    renderVisor(v);
    renderAlert(v);
  }

  function setLink(status) {
    var text = { connecting: 'linking', open: 'linked', closed: 'link lost, retrying', elsewhere: 'open in another tab' }[status] || 'not linked';
    $('link').setAttribute('data-status', status);
    $('link-text').textContent = text;
    // 'elsewhere' is final: another tab has this seat and we do not fight it.
    if (status === 'elsewhere') {
      elsewhere = true;
      render();
    }
  }

  function join(name) {
    myName = name;
    joinError = '';
    window.ArcadeRooms.saveName(name);
    room = window.ArcadeRooms.connect(GAME, {
      name: name,
      onView: function (msg) {
        if (!msg || !msg.v || typeof msg.v !== 'object') return;
        latest = msg;
        render();
      },
      onStatus: setLink,
      onError: function (text) {
        joinError = typeof text === 'string' ? text : 'Could not join.';
        if (room) room.close();
        room = null;
        latest = null;
        setLink('idle');
        render();
      },
    });
    render();
  }

  // ------------------------------------------------------------------ keyboard

  document.addEventListener('keydown', function (event) {
    if (!latest || elsewhere || event.ctrlKey || event.metaKey || event.altKey) return;
    var target = event.target;
    var tag = target && target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    var v = latest.v;
    var em = v.emergency;
    var key = event.key;
    var number = /^[1-3]$/.test(key) ? Number(key) - 1 : -1;

    if (em && em.state === 'open') {
      if (em.kind === 'pick' && number >= 0) answer(number);
      else if (em.kind === 'scan' && number >= 0 && em.choices[number] !== undefined) answer(em.choices[number]);
      else if (em.kind === 'code') {
        if (/^[0-9]$/.test(key)) codeType(key);
        else if (key === 'Backspace') codeClear();
        else if (key === 'Enter') codeSend(); // from anywhere in the task, even on a digit
        else return;
      } else if (em.kind === 'dial') {
        if (key === 'ArrowUp' || key === 'ArrowRight' || key === '+') dialStep(1);
        else if (key === 'ArrowDown' || key === 'ArrowLeft' || key === '-') dialStep(-1);
        else if (key === 'Enter') answer(task.dial);
        else return;
      } else return;
      event.preventDefault();
      return;
    }
    if (em && em.state === 'ringing' && (key === 'r' || key === 'R')) {
      send({ type: 'respond' });
      event.preventDefault();
      return;
    }
    if (v.vote && !v.vote.mine && number >= 0 && v.vote.options[number]) {
      send({ type: 'vote', option: v.vote.options[number].id });
      event.preventDefault();
    }
  });

  setLink('idle');
  render();
})();
