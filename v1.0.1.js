/**
 * CONTATORE EXP ROLE LIBERE — Hunter x Hunter Forum GDR Remastered
 *
 * Pagina personalizzata: si incolla il link di una role, lo script legge tutte
 * le pagine del topic e per ogni partecipante conta post totali, post validi
 * (>= SOGLIA caratteri validi) ed exp. Poi si aggiungono le schede dei PG e i
 * passaggi di proprieta', e si copia il testo per la riscossione.
 *
 * Il conteggio dei caratteri validi e' lo stesso del contacaratteri (v8).
 *
 * Config opzionale, PRIMA di questo script:
 *   window.HxHExpConfig = { soglia: 2000, expPerPost: 5, rootId: 'hxh-exp' };
 *
 * Scritto senza forEach, .click(), innerHTML diretto e "return funzione(",
 * cosi' funziona anche incollato inline su ForumFree.
 */
(function () {
    'use strict';

    var CFG = window.HxHExpConfig || {};
    var SOGLIA = CFG.soglia || 2000;
    var EXP_POST = CFG.expPerPost || 5;
    var ROOT_ID = CFG.rootId || 'hxh-exp';
    var IH = 'inner' + 'HTML';
    var BASE = location.protocol + '//' + location.host;

    // ═══ CONTEGGIO (identico al contacaratteri) ═══

    function rimuovi(radice, sel) {
        var els = radice.querySelectorAll(sel);
        for (var i = 0; i < els.length; i++) {
            if (els[i].parentNode) els[i].parentNode.removeChild(els[i]);
        }
    }

    function antenatoBox(el, radice) {
        var cur = el;
        while (cur && cur !== radice) {
            var style = (cur.getAttribute && cur.getAttribute('style')) || '';
            if (/border-radius/i.test(style) && /border-(left|right|top|bottom)\s*:\s*\d/i.test(style)) return cur;
            cur = cur.parentNode;
        }
        return null;
    }

    function togliBoxCitazione(radice) {
        var divs = radice.querySelectorAll('div');
        var daTogliere = [];
        var i;
        for (i = 0; i < divs.length; i++) {
            var t = divs[i].textContent || '';
            if (t.indexOf('❝') !== -1 || t.indexOf('❞') !== -1) {
                var box = antenatoBox(divs[i], radice);
                if (box && daTogliere.indexOf(box) === -1) daTogliere.push(box);
            }
        }
        for (i = 0; i < daTogliere.length; i++) {
            if (daTogliere[i].parentNode) daTogliere[i].parentNode.removeChild(daTogliere[i]);
        }
    }

    function nodoValido(post) {
        var src = post.querySelector('table.color') || post.querySelector('.color');
        if (!src) return null;
        var d = src.cloneNode(true);
        rimuovi(d, 'span.edit');
        rimuovi(d, 'div.signature');
        rimuovi(d, 'dl.tags');
        rimuovi(d, '.spoiler');
        rimuovi(d, '.quote_top, .quote');
        rimuovi(d, '.code_top, .code');
        togliBoxCitazione(d);
        return d;
    }

    function caratteriValidi(n) {
        var a = (typeof n.innerText === 'string') ? n.innerText : '';
        var b = (typeof n.textContent === 'string') ? n.textContent : '';
        a = a.replace(/\s/g, '').length;
        b = b.replace(/\s/g, '').length;
        var r = (a > b) ? a : b;
        return r;
    }

    // ═══ LETTURA DELLE PAGINE ═══

    // Rispetta la codifica della risposta: il desktop e' servito in windows-1252,
    // e decodificarlo male fa contare doppio le lettere accentate.
    function scarica(url) {
        var p = fetch(url, { credentials: 'same-origin', cache: 'no-store' }).then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            var ct = res.headers.get('content-type') || '';
            var buf = res.arrayBuffer();
            return buf.then(function (b) {
                var m = ct.match(/charset=([^;\s]+)/i);
                var cs = m ? m[1].toLowerCase() : null;
                if (!cs) {
                    var prova = new TextDecoder('utf-8').decode(b);
                    var mm = prova.match(/<meta[^>]+charset=["']?([^"'\s>;]+)/i);
                    cs = mm ? mm[1].toLowerCase() : 'utf-8';
                }
                var txt;
                try { txt = new TextDecoder(cs).decode(b); }
                catch (e) { txt = new TextDecoder('utf-8').decode(b); }
                var doc = new DOMParser().parseFromString(txt, 'text/html');
                return doc;
            });
        });
        return p;
    }

    function titoloTopic(doc) {
        var el = doc.querySelector('.mtitle h1') ||                    // desktop
                 doc.querySelector('.list-group.topic .title strong'); // mobile
        var t = el ? el.textContent : (doc.title || '');
        t = t.replace(/\s+/g, ' ').trim();
        return t;
    }

    function infoPaginazione(doc) {
        var links = doc.querySelectorAll('.pages a');
        var passo = 0, max = 0;
        for (var i = 0; i < links.length; i++) {
            var href = links[i].getAttribute('href') || '';
            var j = href.match(/page_jump\([^,]+,\s*(\d+)\s*,\s*(\d+)\s*\)/);
            if (j) {
                var pagine = parseInt(j[1], 10), perPag = parseInt(j[2], 10);
                if (perPag > 0) { passo = perPag; if ((pagine - 1) * perPag > max) max = (pagine - 1) * perPag; }
            }
            var m = href.match(/[?&]st=(\d+)/);
            if (m) {
                var n = parseInt(m[1], 10);
                if (n > max) max = n;
                if (n > 0 && (!passo || n < passo)) passo = n;
            }
        }
        var res = { passo: passo, max: max };
        return res;
    }

    function leggiPagina(doc, tid, dati) {
        var posts = doc.querySelectorAll('li.post[id^="ee"], td.post[id^="ee"]');
        for (var i = 0; i < posts.length; i++) {
            var post = posts[i];
            var pid = post.id.slice(2);
            if (dati.visti[pid]) continue;
            dati.visti[pid] = true;

            var a = post.querySelector('.nick a[href*="MID="], a.nick[href*="MID="]');
            var uid = '?', nick = 'Sconosciuto';
            if (a) {
                var mm = (a.getAttribute('href') || '').match(/MID=(\d+)/);
                if (mm) uid = mm[1];
                nick = a.textContent.replace(/\s+/g, ' ').trim() || nick;
            } else {
                var nn = post.querySelector('.nick');
                if (nn) { nick = nn.textContent.replace(/\s+/g, ' ').trim(); uid = 'nick:' + nick; }
            }

            var nodo = nodoValido(post);
            var vc = nodo ? caratteriValidi(nodo) : 0;

            dati.post.push({
                pid: pid, uid: uid, nick: nick, vc: vc,
                valido: vc >= SOGLIA,
                url: BASE + '/?t=' + tid + '&p=' + pid
            });
        }
    }

    function riepilogo(dati) {
        var ordine = [], per = {};
        for (var i = 0; i < dati.post.length; i++) {
            var p = dati.post[i];
            if (!per[p.uid]) {
                per[p.uid] = { uid: p.uid, nick: p.nick, tot: 0, validi: 0, sotto: [], scheda: '', pg: '' };
                ordine.push(p.uid);
            }
            var r = per[p.uid];
            r.nick = p.nick;
            r.tot++;
            if (p.valido) r.validi++;
            else r.sotto.push(p);
        }
        var lista = [];
        for (var k = 0; k < ordine.length; k++) {
            var x = per[ordine[k]];
            x.exp = x.validi * EXP_POST;
            lista.push(x);
        }
        return lista;
    }

    // ═══ UTILITA' ═══

    function num(n) {
        var s = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        return s;
    }

    function esc(s) {
        var r = String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        return r;
    }

    // Link per il post: senza style="" prima di href ForumFree lo converte in bbcode
    function linkPost(url, testo) {
        var s = '<a style="" href="' + esc(url) + '">' + esc(testo) + '</a>';
        return s;
    }

    // Accetta link completo, "?t=123" o solo il numero
    function normalizzaLink(v) {
        v = String(v || '').trim();
        if (!v) return '';
        if (/^\d+$/.test(v)) { v = BASE + '/?t=' + v; return v; }
        if (/^\?t=/.test(v)) { v = BASE + '/' + v; return v; }
        return v;
    }

    // ═══ STILE (come la pagina Apertura Pack) ═══

    var R = '#' + ROOT_ID;
    var CSS = '' +
        R + '{--ex-bg:#292354;--ex-panel:#0B486B;--ex-border:#3B8686;--ex-text:#E2F7C4;--ex-accent:#CFF09E;--ex-soft:#8FBEBA;--ex-btn:#79BD9A;--ex-btntext:#292354;--ex-err:#ff9e9e;max-width:640px;margin:20px auto;padding:0 10px;box-sizing:border-box;font-family:Montserrat,sans-serif;font-size:13px;line-height:1.45;text-align:left;}' +
        '.bodyhalloween ' + R + '{--ex-bg:#262A20;--ex-panel:#43281A;--ex-border:#B65718;--ex-text:#F4D3BD;--ex-accent:#FF9955;--ex-soft:#CF9269;--ex-btn:#FF9955;--ex-btntext:#262A20;--ex-err:#F4D3BD;}' +
        '.bodyhalloween ' + R + ' .ex-box{border-color:#B87040;}' +
        '.bodyhalloween ' + R + ' .ex-status.ex-err{font-weight:bold;text-decoration:underline;text-decoration-color:#B65718;}' +
        '.bodynatale ' + R + '{--ex-bg:#25342F;--ex-panel:#2A4F40;--ex-border:#5E7E71;--ex-text:#EBDCC9;--ex-accent:#B18C72;--ex-soft:#94A49D;--ex-btn:#931D2D;--ex-btntext:#EBDCC9;--ex-err:#EBDCC9;}' +
        '.bodynatale ' + R + ' .ex-box{border-color:#B18C72;}' +
        '.bodynatale ' + R + ' .ex-title{color:#EBDCC9;}' +
        '.bodynatale ' + R + ' .ex-status.ex-err{font-weight:bold;text-decoration:underline;text-decoration-color:#B54B48;}' +
        R + ' *{box-sizing:border-box;}' +
        R + ' .ex-box{background:var(--ex-bg);border:2px solid var(--ex-border);border-radius:10px;padding:18px 20px;color:var(--ex-text);}' +
        R + ' .ex-title{font-family:Calistoga,serif;font-size:26px;color:var(--ex-accent);text-align:center;letter-spacing:1px;margin:0;}' +
        R + ' .ex-sub{text-align:center;color:var(--ex-soft);font-size:13px;margin:4px 0 14px;}' +
        R + ' table.ex-form{width:100%;border-collapse:collapse;table-layout:fixed;border:0;}' +
        R + ' table.ex-form td{padding:6px 4px;vertical-align:top;border:0;background:transparent;}' +
        R + ' td.ex-l{width:36%;font-family:"Alegreya Sans SC",sans-serif;font-size:15px;color:var(--ex-accent);padding-top:12px;word-wrap:break-word;}' +
        R + ' select,' + R + ' input[type=text],' + R + ' textarea{display:block;width:100%;height:auto;min-height:34px;margin:0;padding:6px 8px;background:var(--ex-panel);color:var(--ex-text);border:1px solid var(--ex-border);border-radius:5px;font-family:Montserrat,sans-serif;font-size:13px;}' +
        R + ' input.ex-pg,' + R + ' input.ex-cosa{margin-top:6px;}' +
        R + ' textarea{min-height:160px;font-size:11px;margin-top:8px;resize:vertical;}' +
        R + ' .ex-hint{font-size:11px;color:var(--ex-soft);margin:4px 0 0;}' +
        R + ' .ex-actions{text-align:center;margin-top:14px;}' +
        R + ' button{display:inline-block;width:auto;height:auto;cursor:pointer;background:var(--ex-btn);color:var(--ex-btntext);border:1px solid var(--ex-border);border-radius:6px;padding:10px 26px;font-family:"Alegreya Sans SC",sans-serif;font-size:17px;font-weight:bold;letter-spacing:1px;margin:4px;}' +
        R + ' button.ex-small{padding:5px 14px;font-size:14px;}' +
        R + ' button.ex-del{padding:4px 0;width:100%;font-size:15px;margin:0;}' +
        R + ' button[disabled]{opacity:.5;cursor:default;}' +
        R + ' .ex-status{text-align:center;margin-top:12px;min-height:18px;color:var(--ex-accent);}' +
        R + ' .ex-status.ex-err{color:var(--ex-err);}' +
        R + ' .ex-sec{font-family:"Alegreya Sans SC",sans-serif;font-size:19px;color:var(--ex-accent);margin:22px 0 6px;padding-bottom:3px;border-bottom:1px solid var(--ex-border);}' +
        R + ' .ex-role{font-family:Calistoga,serif;font-size:19px;text-align:center;margin:18px 0 2px;}' +
        R + ' a{color:var(--ex-accent);font-weight:bold;text-decoration:none;}' +
        R + ' table.ex-tab{width:100%;border-collapse:collapse;table-layout:fixed;border:1px solid var(--ex-border);margin-top:8px;}' +
        R + ' table.ex-tab th{font-family:"Alegreya Sans SC",sans-serif;font-size:15px;font-weight:normal;color:var(--ex-text);background:var(--ex-border);padding:6px 4px;text-align:center;border:0;}' +
        R + ' table.ex-tab td{padding:6px 4px;text-align:center;color:var(--ex-text);border:0;border-top:1px solid var(--ex-border);background:transparent;word-wrap:break-word;}' +
        R + ' table.ex-tab tr.ex-odd td{background:var(--ex-panel);}' +
        R + ' table.ex-tab th.ex-c1,' + R + ' table.ex-tab td.ex-c1{width:46%;text-align:left;padding-left:8px;}' +
        R + ' table.ex-tab td.ex-exp{color:var(--ex-accent);font-weight:bold;}' +
        R + ' ul.ex-list{margin:6px 0 0;padding:0;list-style:none;}' +
        R + ' ul.ex-list li{list-style:none;padding:2px 0;margin:0;font-size:12px;}' +
        R + ' .ex-nick{font-weight:bold;}' +
        R + ' .ex-pass{background:var(--ex-panel);border:1px solid var(--ex-border);border-radius:6px;padding:8px;margin-top:8px;}' +
        R + ' .ex-pass select{background:var(--ex-bg);}' +
        R + ' .ex-pass input[type=text]{background:var(--ex-bg);}' +
        R + ' table.ex-pt{width:100%;border-collapse:collapse;table-layout:fixed;border:0;}' +
        R + ' table.ex-pt td{padding:0;border:0;background:transparent;vertical-align:middle;}' +
        R + ' td.ex-arrow{width:26px;text-align:center;color:var(--ex-accent);font-size:16px;}' +
        R + ' td.ex-x{width:38px;padding-left:6px !important;}';

    function stileUnaVolta() {
        if (document.getElementById(ROOT_ID + '-style')) return;
        var s = document.createElement('style');
        s.id = ROOT_ID + '-style';
        s.textContent = CSS;
        document.head.appendChild(s);
    }

    // ═══ PAGINA ═══

    function avvia() {
        var root = document.getElementById(ROOT_ID);
        if (!root || root.getAttribute('data-pronto')) return;
        root.setAttribute('data-pronto', '1');
        stileUnaVolta();

        root[IH] =
            '<div class="ex-box">' +
                '<div class="ex-title">Calcolo EXP</div>' +
                '<div class="ex-sub">Incolla il link della role conclusa: ogni post con almeno ' + num(SOGLIA) +
                    ' caratteri validi vale ' + EXP_POST + ' exp.</div>' +
                '<table class="ex-form"><tr>' +
                    '<td class="ex-l">Link della role</td>' +
                    '<td><input type="text" class="ex-link" placeholder="' + esc(BASE) + '/?t=..."></td>' +
                '</tr></table>' +
                '<div class="ex-actions"><button type="button" class="ex-go">Calcola</button></div>' +
                '<div class="ex-status"></div>' +
                '<div class="ex-result"></div>' +
            '</div>';

        var q = function (sel) { var e = root.querySelector(sel); return e; };
        var inLink = q('.ex-link'), btnGo = q('.ex-go'), stato = q('.ex-status'), esito = q('.ex-result');

        var S = null;  // { titolo, linkRole, lista, passaggi, manuale }

        function setStato(msg, err) {
            stato.textContent = msg;
            stato.className = 'ex-status' + (err ? ' ex-err' : '');
        }

        function perUid(uid) {
            for (var i = 0; i < S.lista.length; i++) if (S.lista[i].uid === uid) return S.lista[i];
            return null;
        }

        function nomePG(uid) {
            var p = perUid(uid);
            var n = p ? (p.pg || p.nick) : '';
            return n;
        }

        // ── testo per la riscossione ──
        function genera() {
            var r = [];
            r.push('<b>Role:</b> ' + linkPost(S.linkRole, S.titolo));
            r.push('');
            for (var i = 0; i < S.lista.length; i++) {
                var p = S.lista[i];
                var riga = '<b>' + esc(p.nick) + ':</b> ';
                if (p.scheda) riga += linkPost(p.scheda, p.pg || 'Scheda') + ' — ';
                else if (p.pg) riga += esc(p.pg) + ' — ';
                riga += p.tot + ' post, ' + p.validi + ' validi → ' + p.exp + ' exp';
                r.push(riga);
            }
            var pass = [];
            for (var k = 0; k < S.passaggi.length; k++) {
                var x = S.passaggi[k];
                if (!x.da || !x.a || !String(x.cosa).trim()) continue;
                pass.push(esc(nomePG(x.da)) + ' → ' + esc(nomePG(x.a)) + ': ' + esc(String(x.cosa).trim()));
            }
            if (pass.length) {
                r.push('');
                r.push('<b>Passaggi di proprietà:</b>');
                for (var z = 0; z < pass.length; z++) r.push(pass[z]);
            }
            var t = r.join('\n');
            return t;
        }

        function aggiornaTesto(forza) {
            if (!S) return;
            if (S.manuale && !forza) return;
            S.manuale = false;
            q('.ex-testo').value = genera();
            q('.ex-man').style.display = 'none';
        }

        // ── passaggi di proprieta' ──
        function opzioni(sel) {
            var h = '<option value="">—</option>';
            for (var i = 0; i < S.lista.length; i++) {
                var p = S.lista[i];
                h += '<option value="' + esc(p.uid) + '"' + (p.uid === sel ? ' selected' : '') + '>' + esc(p.pg || p.nick) + '</option>';
            }
            return h;
        }

        function disegnaPassaggi() {
            var box = q('.ex-passaggi');
            if (!S.passaggi.length) {
                box[IH] = '<div class="ex-hint">Nessun passaggio inserito.</div>';
                return;
            }
            var h = '';
            for (var i = 0; i < S.passaggi.length; i++) {
                var x = S.passaggi[i];
                h += '<div class="ex-pass" data-i="' + i + '">' +
                     '<table class="ex-pt"><tr>' +
                        '<td><select class="ex-da">' + opzioni(x.da) + '</select></td>' +
                        '<td class="ex-arrow">→</td>' +
                        '<td><select class="ex-a">' + opzioni(x.a) + '</select></td>' +
                        '<td class="ex-x"><button type="button" class="ex-del" title="Togli">×</button></td>' +
                     '</tr></table>' +
                     '<input type="text" class="ex-cosa" placeholder="Cosa (es. 50.000 Jenny, Ringschwert Lv.2)" value="' + esc(x.cosa) + '">' +
                     '</div>';
            }
            box[IH] = h;
        }

        // ── titolo della scheda come nome del PG ──
        function nomeDaScheda(uid, link) {
            var m = String(link).match(/[?&]t=(\d+)/);
            if (!m) return;
            var input = root.querySelector('input.ex-pg[data-uid="' + uid + '"]');
            if (!input || input.value.trim()) return;
            input.placeholder = 'Lettura della scheda...';
            scarica(BASE + '/?t=' + m[1]).then(function (doc) {
                var t = titoloTopic(doc);
                var p = perUid(uid);
                input.placeholder = 'Nome del PG';
                if (!t || !p || input.value.trim()) return;
                input.value = t;
                p.pg = t;
                disegnaPassaggi();
                aggiornaTesto(false);
            }).catch(function () { input.placeholder = 'Nome del PG'; });
        }

        // ── risultato ──
        function mostra(dati, tid) {
            var lista = riepilogo(dati);
            S = { titolo: dati.titolo || ('Topic ' + tid), linkRole: BASE + '/?t=' + tid, lista: lista, passaggi: [], manuale: false };

            var h = '<div class="ex-role"><a href="' + esc(S.linkRole) + '" target="_blank">' + esc(S.titolo) + '</a></div>' +
                    '<div class="ex-hint" style="text-align:center">' + dati.post.length + ' post letti</div>';

            h += '<table class="ex-tab"><tr><th class="ex-c1">Partecipante</th><th>Post</th><th>Validi</th><th>EXP</th></tr>';
            for (var i = 0; i < lista.length; i++) {
                var r = lista[i];
                h += '<tr' + (i % 2 ? '' : ' class="ex-odd"') + '><td class="ex-c1">' + esc(r.nick) + '</td><td>' + r.tot +
                     '</td><td>' + r.validi + '</td><td class="ex-exp">' + r.exp + '</td></tr>';
            }
            h += '</table>';

            var sotto = '';
            for (var k = 0; k < lista.length; k++) {
                if (!lista[k].sotto.length) continue;
                var pezzi = [];
                for (var z = 0; z < lista[k].sotto.length; z++) {
                    var p = lista[k].sotto[z];
                    pezzi.push('<a href="' + esc(p.url) + '" target="_blank">' + num(p.vc) + '</a>');
                }
                sotto += '<li><span class="ex-nick">' + esc(lista[k].nick) + ':</span> ' + pezzi.join(', ') + '</li>';
            }
            if (sotto) {
                h += '<div class="ex-sec">Post sotto soglia</div>' +
                     '<div class="ex-hint">Caratteri validi dei post non conteggiati. Clicca per aprirli.</div>' +
                     '<ul class="ex-list">' + sotto + '</ul>';
            }

            h += '<div class="ex-sec">Schede dei PG</div>' +
                 '<div class="ex-hint">Incollando il link della scheda, il nome del PG viene preso dal titolo del topic. Puoi correggerlo.</div>' +
                 '<table class="ex-form">';
            for (var a = 0; a < lista.length; a++) {
                var u = esc(lista[a].uid);
                h += '<tr><td class="ex-l">' + esc(lista[a].nick) + '</td><td>' +
                     '<input type="text" class="ex-scheda" data-uid="' + u + '" placeholder="Link della scheda">' +
                     '<input type="text" class="ex-pg" data-uid="' + u + '" placeholder="Nome del PG">' +
                     '</td></tr>';
            }
            h += '</table>';

            h += '<div class="ex-sec">Passaggi di proprietà</div>' +
                 '<div class="ex-hint">Soldi o oggetti che un PG ha dato a un altro durante la role.</div>' +
                 '<div class="ex-passaggi"></div>' +
                 '<div class="ex-actions"><button type="button" class="ex-small ex-add">+ Aggiungi passaggio</button></div>';

            h += '<div class="ex-sec">Testo per la riscossione</div>' +
                 '<textarea class="ex-testo"></textarea>' +
                 '<div class="ex-hint ex-man" style="display:none">Hai modificato il testo a mano, quindi i campi sopra non lo aggiornano più. ' +
                    '<button type="button" class="ex-small ex-rigenera">Rigenera</button></div>' +
                 '<div class="ex-actions"><button type="button" class="ex-copia">Copia</button></div>';

            esito[IH] = h;
            setStato('', false);
            btnGo.disabled = false;
            disegnaPassaggi();
            aggiornaTesto(true);
        }

        // ── calcolo ──
        function calcola() {
            var val = (inLink.value || '').trim();
            var m = val.match(/[?&]t=(\d+)/) || val.match(/^(\d+)$/);
            if (!m) { setStato('Link non valido: deve contenere ?t= seguito dal numero della discussione.', true); return; }
            var tid = m[1];
            var dati = { visti: {}, post: [], titolo: '' };

            btnGo.disabled = true;
            esito[IH] = '';
            S = null;
            setStato('Lettura della pagina 1...', false);

            scarica(BASE + '/?t=' + tid).then(function (doc) {
                dati.titolo = titoloTopic(doc);
                leggiPagina(doc, tid, dati);
                if (!dati.post.length) throw new Error('vuoto');

                var pag = infoPaginazione(doc);
                var offsets = [];
                if (pag.passo) {
                    for (var st = pag.passo; st <= pag.max; st += pag.passo) offsets.push(st);
                }
                var totale = offsets.length + 1;
                var idx = 0;

                function prossima() {
                    if (idx >= offsets.length) { mostra(dati, tid); return null; }
                    var st = offsets[idx++];
                    setStato('Lettura della pagina ' + (idx + 1) + ' di ' + totale + '...', false);
                    var p = scarica(BASE + '/?t=' + tid + '&st=' + st).then(function (d) {
                        leggiPagina(d, tid, dati);
                        var n = prossima();
                        return n;
                    });
                    return p;
                }
                var catena = prossima();
                return catena;
            }).catch(function (e) {
                btnGo.disabled = false;
                if (e && e.message === 'vuoto') {
                    setStato('Nessun post trovato: controlla il link, oppure la sezione non è visibile con il tuo account.', true);
                } else {
                    setStato('Errore durante la lettura del topic (' + (e && e.message ? e.message : e) + ').', true);
                }
            });
        }

        // ── eventi (delegati sulla pagina) ──
        root.addEventListener('click', function (e) {
            var t = e.target;
            if (!t || !t.classList) return;

            if (t.classList.contains('ex-go')) { calcola(); return; }
            if (!S) return;

            if (t.classList.contains('ex-add')) {
                S.passaggi.push({ da: '', a: '', cosa: '' });
                disegnaPassaggi();
                return;
            }
            if (t.classList.contains('ex-del')) {
                var riga = t.closest('.ex-pass');
                S.passaggi.splice(parseInt(riga.getAttribute('data-i'), 10), 1);
                disegnaPassaggi();
                aggiornaTesto(false);
                return;
            }
            if (t.classList.contains('ex-rigenera')) { aggiornaTesto(true); return; }
            if (t.classList.contains('ex-copia')) {
                var area = q('.ex-testo');
                var fatto = function () {
                    t.textContent = 'Copiato!';
                    setTimeout(function () { t.textContent = 'Copia'; }, 1500);
                };
                var ripiego = function () {
                    area.focus();
                    area.select();
                    try { document.execCommand('copy'); fatto(); } catch (err) { t.textContent = 'Copia a mano'; }
                };
                if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(area.value).then(fatto, ripiego);
                else ripiego();
            }
        });

        root.addEventListener('input', function (e) {
            var t = e.target;
            if (!S || !t || !t.classList) return;
            if (t.classList.contains('ex-testo')) {
                S.manuale = true;
                q('.ex-man').style.display = 'block';
                return;
            }
            if (t.classList.contains('ex-pg')) {
                var p = perUid(t.getAttribute('data-uid'));
                if (p) p.pg = t.value.trim();
                aggiornaTesto(false);
                return;
            }
            if (t.classList.contains('ex-scheda')) {
                var ps = perUid(t.getAttribute('data-uid'));
                if (ps) ps.scheda = normalizzaLink(t.value);
                aggiornaTesto(false);
                return;
            }
            if (t.classList.contains('ex-cosa')) {
                var riga = t.closest('.ex-pass');
                S.passaggi[parseInt(riga.getAttribute('data-i'), 10)].cosa = t.value;
                aggiornaTesto(false);
            }
        });

        root.addEventListener('change', function (e) {
            var t = e.target;
            if (!S || !t || !t.classList) return;
            if (t.classList.contains('ex-da') || t.classList.contains('ex-a')) {
                var riga = t.closest('.ex-pass');
                var x = S.passaggi[parseInt(riga.getAttribute('data-i'), 10)];
                if (t.classList.contains('ex-da')) x.da = t.value; else x.a = t.value;
                aggiornaTesto(false);
                return;
            }
            // nomi aggiornati nei menu dei passaggi solo a fine digitazione
            if (t.classList.contains('ex-pg')) { disegnaPassaggi(); return; }
            if (t.classList.contains('ex-scheda')) nomeDaScheda(t.getAttribute('data-uid'), normalizzaLink(t.value));
        });

        inLink.addEventListener('keydown', function (e) { if (e.key === 'Enter') calcola(); });
    }

    // Esposte per i test, non servono alla pagina
    window.HxHExpCalc = { leggiPagina: leggiPagina, infoPaginazione: infoPaginazione, titoloTopic: titoloTopic, riepilogo: riepilogo };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', avvia);
    else avvia();
})();
