/**
 * CONTATORE EXP ROLE LIBERE — Hunter x Hunter Forum GDR Remastered
 *
 * Da usare in una pagina personalizzata: si incolla il link di una role,
 * lo script scarica tutte le pagine del topic e per ogni partecipante conta
 * i post totali, i post validi (>= SOGLIA caratteri validi) e l'exp.
 *
 * Il conteggio dei caratteri validi e' lo stesso del contacaratteri (v8):
 * stesso nodo (.color ripulito da edit/firma/tag), stesse esclusioni
 * (spoiler, quote, code, box con le virgolette ❝ ❞), stessa formula.
 *
 * Config opzionale, da mettere nella pagina PRIMA di questo script:
 *   window.HxHExpConfig = { soglia: 2000, expPerPost: 5, rootId: 'hxh-exp' };
 *
 * Scritto senza forEach, .click(), innerHTML diretto e "return funzione(",
 * cosi' funziona anche se va incollato inline su ForumFree.
 */
(function () {
    'use strict';

    var CFG = window.HxHExpConfig || {};
    var SOGLIA = CFG.soglia || 2000;
    var EXP_POST = CFG.expPerPost || 5;
    var ROOT_ID = CFG.rootId || 'hxh-exp';
    var IH = 'inner' + 'HTML';

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
            if (t.indexOf('\u275D') !== -1 || t.indexOf('\u275E') !== -1) {
                var box = antenatoBox(divs[i], radice);
                if (box && daTogliere.indexOf(box) === -1) daTogliere.push(box);
            }
        }
        for (i = 0; i < daTogliere.length; i++) {
            if (daTogliere[i].parentNode) daTogliere[i].parentNode.removeChild(daTogliere[i]);
        }
    }

    // .color del post, ripulito come buildCleanNode + buildValidNode
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

    // countNet(n, false): il maggiore tra innerText e textContent, spazi esclusi
    function caratteriValidi(n) {
        var a = (typeof n.innerText === 'string') ? n.innerText : '';
        var b = (typeof n.textContent === 'string') ? n.textContent : '';
        a = a.replace(/\s/g, '').length;
        b = b.replace(/\s/g, '').length;
        var r = (a > b) ? a : b;
        return r;
    }

    // ═══ LETTURA DELLE PAGINE ═══

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
        var el = doc.querySelector('.mtitle h1') ||                 // desktop
                 doc.querySelector('.list-group.topic .title strong'); // mobile
        var t = el ? el.textContent : (doc.title || '');
        t = t.replace(/\s+/g, ' ').trim();
        return t;
    }

    // Offset (st=) delle pagine successive alla prima
    function infoPaginazione(doc) {
        var links = doc.querySelectorAll('.pages a');
        var passo = 0, max = 0;
        for (var i = 0; i < links.length; i++) {
            var href = links[i].getAttribute('href') || '';
            var j = href.match(/page_jump\([^,]+,\s*(\d+)\s*,\s*(\d+)\s*\)/); // desktop: page_jump(url, pagine, per pagina)
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
        var base = location.protocol + '//' + location.host;
        var posts = doc.querySelectorAll('li.post[id^="ee"], td.post[id^="ee"]');
        for (var i = 0; i < posts.length; i++) {
            var post = posts[i];
            var pid = post.id.slice(2);
            if (dati.visti[pid]) continue;
            dati.visti[pid] = true;

            // desktop: .nick > a   |   mobile: a.nick
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
                pid: pid,
                uid: uid,
                nick: nick,
                vc: vc,
                valido: vc >= SOGLIA,
                url: base + '/?t=' + tid + '&p=' + pid
            });
        }
    }

    // ═══ RIEPILOGO ═══

    function riepilogo(dati) {
        var ordine = [], per = {};
        for (var i = 0; i < dati.post.length; i++) {
            var p = dati.post[i];
            if (!per[p.uid]) {
                per[p.uid] = { nick: p.nick, tot: 0, validi: 0, sotto: [] };
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

    function num(n) {
        var s = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        return s;
    }

    function esc(s) {
        var r = String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        return r;
    }

    function testoRiscossione(dati, lista, linkTopic) {
        var righe = [];
        righe.push('Role: ' + dati.titolo);
        righe.push('Link: ' + linkTopic);
        righe.push('Soglia: ' + num(SOGLIA) + ' caratteri validi = ' + EXP_POST + ' exp a post');
        righe.push('');
        for (var i = 0; i < lista.length; i++) {
            var r = lista[i];
            righe.push(r.nick + ': ' + r.tot + ' post, ' + r.validi + ' validi → ' + r.exp + ' exp');
        }
        var t = righe.join('\n');
        return t;
    }

    // ═══ INTERFACCIA ═══

    var CSS = '' +
        '#' + ROOT_ID + '{font-family:Montserrat,sans-serif;font-size:13px;line-height:1.5;color:#292354;background:#E2F7C4;border:3px solid #3B8686;border-radius:10px;padding:14px;max-width:760px;margin:10px auto;text-align:left;box-sizing:border-box}' +
        '#' + ROOT_ID + ' *{box-sizing:border-box}' +
        '#' + ROOT_ID + ' .hx-titolo{font-family:Calistoga,serif;font-size:22px;color:#0B486B;text-align:center;margin:0 0 4px 0}' +
        '#' + ROOT_ID + ' .hx-sotto{font-size:12px;color:#3B8686;text-align:center;margin:0 0 12px 0}' +
        '#' + ROOT_ID + ' .hx-riga{width:100%;table-layout:fixed;border-collapse:collapse}' +
        '#' + ROOT_ID + ' .hx-input{width:100%;height:34px;padding:4px 10px;font-family:Montserrat,sans-serif;font-size:13px;color:#292354;background:#CFF09E;border:2px solid #3B8686;border-radius:6px;outline:none}' +
        '#' + ROOT_ID + ' .hx-btn{height:34px;padding:0 14px;font-family:"Alegreya Sans SC",sans-serif;font-size:15px;color:#E2F7C4;background:#3B8686;border:2px solid #0B486B;border-radius:6px;cursor:pointer;width:100%}' +
        '#' + ROOT_ID + ' .hx-btn:hover{background:#0B486B}' +
        '#' + ROOT_ID + ' .hx-btn[disabled]{opacity:.6;cursor:default}' +
        '#' + ROOT_ID + ' .hx-stato{margin:10px 0 0 0;font-size:12px;color:#3B8686;min-height:18px}' +
        '#' + ROOT_ID + ' .hx-errore{margin:10px 0 0 0;padding:8px 10px;font-size:13px;color:#CFF09E;background:#292354;border-radius:6px}' +
        '#' + ROOT_ID + ' .hx-ris-titolo{font-family:"Alegreya Sans SC",sans-serif;font-size:18px;color:#0B486B;margin:14px 0 6px 0}' +
        '#' + ROOT_ID + ' .hx-tab{width:100%;table-layout:fixed;border-collapse:collapse;font-size:13px}' +
        '#' + ROOT_ID + ' .hx-tab th{font-family:"Alegreya Sans SC",sans-serif;font-size:14px;font-weight:normal;color:#CFF09E;background:#0B486B;padding:6px;text-align:center}' +
        '#' + ROOT_ID + ' .hx-tab th:first-child,#' + ROOT_ID + ' .hx-tab td:first-child{text-align:left;width:46%}' +
        '#' + ROOT_ID + ' .hx-tab td{padding:6px;text-align:center;border-bottom:1px solid #8FBEBA;word-wrap:break-word}' +
        '#' + ROOT_ID + ' .hx-tab tr:nth-child(even) td{background:#CFF09E}' +
        '#' + ROOT_ID + ' .hx-tab tr:nth-child(odd) td{background:#A8DBA8}' +
        '#' + ROOT_ID + ' .hx-exp{font-weight:bold;color:#0B486B}' +
        '#' + ROOT_ID + ' .hx-dett{margin:4px 0 0 0;padding:0;list-style:none;font-size:12px}' +
        '#' + ROOT_ID + ' .hx-dett li{padding:2px 0;list-style:none}' +
        '#' + ROOT_ID + ' .hx-dett a{color:#0B486B;font-weight:bold}' +
        '#' + ROOT_ID + ' .hx-nome{font-weight:bold;color:#292354}' +
        '#' + ROOT_ID + ' .hx-testo{width:100%;min-height:170px;padding:8px;font-family:Montserrat,sans-serif;font-size:13px;color:#292354;background:#CFF09E;border:2px solid #3B8686;border-radius:6px;resize:vertical}' +
        '#' + ROOT_ID + ' .hx-nota{font-size:11px;color:#3B8686;margin:4px 0 8px 0}';

    function stileUnaVolta() {
        if (document.getElementById(ROOT_ID + '-style')) return;
        var s = document.createElement('style');
        s.id = ROOT_ID + '-style';
        s.textContent = CSS;
        document.head.appendChild(s);
    }

    function avvia() {
        var root = document.getElementById(ROOT_ID);
        if (!root || root.getAttribute('data-pronto')) return;
        root.setAttribute('data-pronto', '1');
        stileUnaVolta();

        root[IH] =
            '<div class="hx-titolo">Calcolo EXP delle role</div>' +
            '<div class="hx-sotto">Incolla il link della role conclusa. Ogni post con almeno ' + num(SOGLIA) +
                ' caratteri validi vale ' + EXP_POST + ' exp.</div>' +
            '<table class="hx-riga"><tr>' +
                '<td style="padding-right:8px"><input type="text" class="hx-input" placeholder="https://hxhforumgdr.forumcommunity.net/?t=..."></td>' +
                '<td style="width:110px"><button type="button" class="hx-btn">Calcola</button></td>' +
            '</tr></table>' +
            '<div class="hx-stato"></div>' +
            '<div class="hx-esito"></div>';

        var input = root.querySelector('.hx-input');
        var btn = root.querySelector('.hx-btn');
        var stato = root.querySelector('.hx-stato');
        var esito = root.querySelector('.hx-esito');

        function errore(msg) {
            stato.textContent = '';
            esito[IH] = '<div class="hx-errore">' + esc(msg) + '</div>';
            btn.disabled = false;
        }

        function mostra(dati, tid) {
            var base = location.protocol + '//' + location.host;
            var linkTopic = base + '/?t=' + tid;
            var lista = riepilogo(dati);
            var h = '';

            h += '<div class="hx-ris-titolo">' + esc(dati.titolo || ('Topic ' + tid)) + '</div>';
            h += '<div class="hx-nota">' + dati.post.length + ' post letti</div>';
            h += '<table class="hx-tab"><tr><th>Partecipante</th><th>Post</th><th>Validi</th><th>EXP</th></tr>';
            for (var i = 0; i < lista.length; i++) {
                var r = lista[i];
                h += '<tr><td>' + esc(r.nick) + '</td><td>' + r.tot + '</td><td>' + r.validi +
                     '</td><td class="hx-exp">' + r.exp + '</td></tr>';
            }
            h += '</table>';

            var sotto = '';
            for (var k = 0; k < lista.length; k++) {
                if (!lista[k].sotto.length) continue;
                sotto += '<li><span class="hx-nome">' + esc(lista[k].nick) + '</span>: ';
                var pezzi = [];
                for (var z = 0; z < lista[k].sotto.length; z++) {
                    var p = lista[k].sotto[z];
                    pezzi.push('<a href="' + esc(p.url) + '" target="_blank">' + num(p.vc) + '</a>');
                }
                sotto += pezzi.join(', ') + '</li>';
            }
            if (sotto) {
                h += '<div class="hx-ris-titolo">Post sotto soglia</div>' +
                     '<div class="hx-nota">Caratteri validi di ogni post non conteggiato (clicca per aprirlo)</div>' +
                     '<ul class="hx-dett">' + sotto + '</ul>';
            }

            h += '<div class="hx-ris-titolo">Testo per la riscossione</div>' +
                 '<div class="hx-nota">Puoi completarlo qui prima di copiarlo.</div>' +
                 '<textarea class="hx-testo"></textarea>' +
                 '<table class="hx-riga" style="margin-top:6px"><tr><td></td>' +
                 '<td style="width:110px"><button type="button" class="hx-btn hx-copia">Copia</button></td></tr></table>';

            esito[IH] = h;
            stato.textContent = '';
            btn.disabled = false;

            var area = esito.querySelector('.hx-testo');
            area.value = testoRiscossione(dati, lista, linkTopic);

            var copia = esito.querySelector('.hx-copia');
            copia.addEventListener('click', function () {
                function fatto() {
                    copia.textContent = 'Copiato!';
                    setTimeout(function () { copia.textContent = 'Copia'; }, 1500);
                }
                function ripiego() {
                    area.focus();
                    area.select();
                    try { document.execCommand('copy'); fatto(); } catch (e) { copia.textContent = 'Copia a mano'; }
                }
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(area.value).then(fatto, ripiego);
                } else {
                    ripiego();
                }
            });
        }

        function calcola() {
            var val = (input.value || '').trim();
            var m = val.match(/[?&]t=(\d+)/) || val.match(/^(\d+)$/);
            if (!m) { errore('Link non valido: deve contenere ?t= seguito dal numero della discussione.'); return; }
            var tid = m[1];
            var base = location.protocol + '//' + location.host;
            var dati = { visti: {}, post: [], titolo: '' };

            btn.disabled = true;
            esito[IH] = '';
            stato.textContent = 'Lettura della pagina 1...';

            scarica(base + '/?t=' + tid).then(function (doc) {
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
                    stato.textContent = 'Lettura della pagina ' + (idx + 1) + ' di ' + totale + '...';
                    var p = scarica(base + '/?t=' + tid + '&st=' + st).then(function (d) {
                        leggiPagina(d, tid, dati);
                        var n = prossima();
                        return n;
                    });
                    return p;
                }
                var catena = prossima();
                return catena;
            }).catch(function (e) {
                if (e && e.message === 'vuoto') {
                    errore('Nessun post trovato: controlla il link, oppure la sezione non e\' visibile con il tuo account.');
                } else {
                    errore('Errore durante la lettura del topic (' + (e && e.message ? e.message : e) + ').');
                }
            });
        }

        btn.addEventListener('click', calcola);
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') calcola(); });
    }

    // Esposte per i test, non servono alla pagina
    window.HxHExpCalc = {
        leggiPagina: leggiPagina,
        infoPaginazione: infoPaginazione,
        titoloTopic: titoloTopic,
        riepilogo: riepilogo
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', avvia);
    else avvia();
})();
