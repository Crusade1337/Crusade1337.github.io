// ---------------------------------------------------------------------------

window.WallGod = {};
window.WallGod.Library = (function () {
  /**** TribalWarsLibrary.js ****/
  if (typeof window.twLib === 'undefined') {
    window.twLib = {
      queues: null,
      init: function () {
        if (this.queues === null) {
          this.queues = this.queueLib.createQueues(5);
        }
      },
      queueLib: {
        maxAttempts: 3,
        Item: function (action, arg, promise = null) {
          this.action = action;
          this.arguments = arg;
          this.promise = promise;
          this.attempts = 0;
        },
        Queue: function () {
          this.list = [];
          this.working = false;
          this.length = 0;

          this.doNext = function () {
            let item = this.dequeue();
            let self = this;

            if (item.action == 'openWindow') {
              window
                .open(...item.arguments)
                .addEventListener(
                  'DOMContentLoaded',
                  function () {
                    self.start();
                  }
                );
            } else {
              $[item.action](...item.arguments)
                .done(function () {
                  item.promise.resolve.apply(null, arguments);
                  self.start();
                })
                .fail(function () {
                  item.attempts += 1;
                  if (
                    item.attempts <
                    twLib.queueLib.maxAttempts
                  ) {
                    self.enqueue(item, true);
                  } else {
                    item.promise.reject.apply(
                      null,
                      arguments
                    );
                  }

                  self.start();
                });
            }
          };

          this.start = function () {
            if (this.length) {
              this.working = true;
              this.doNext();
            } else {
              this.working = false;
            }
          };

          this.dequeue = function () {
            this.length -= 1;
            return this.list.shift();
          };

          this.enqueue = function (item, front = false) {
            front ? this.list.unshift(item) : this.list.push(item);
            this.length += 1;

            if (!this.working) {
              this.start();
            }
          };
        },
        createQueues: function (amount) {
          let arr = [];

          for (let i = 0; i < amount; i++) {
            arr[i] = new twLib.queueLib.Queue();
          }

          return arr;
        },
        addItem: function (item) {
          let leastBusyQueue = twLib.queues
            .map((q) => q.length)
            .reduce((next, curr) => (curr < next ? curr : next), 0);
          twLib.queues[leastBusyQueue].enqueue(item);
        },
        orchestrator: function (type, arg) {
          let promise = $.Deferred();
          let item = new twLib.queueLib.Item(type, arg, promise);

          twLib.queueLib.addItem(item);

          return promise;
        },
      },
      ajax: function () {
        return twLib.queueLib.orchestrator('ajax', arguments);
      },
      get: function () {
        return twLib.queueLib.orchestrator('get', arguments);
      },
      post: function () {
        return twLib.queueLib.orchestrator('post', arguments);
      },
      openWindow: function () {
        let item = new twLib.queueLib.Item('openWindow', arguments);

        twLib.queueLib.addItem(item);
      },
    };

    twLib.init();
  }

  /**** Script Library ****/
  const setUnitSpeeds = function () {
    let unitSpeeds = {};

    $.when($.get('/interface.php?func=get_unit_info')).then((xml) => {
      $(xml)
        .find('config')
        .children()
        .map((i, el) => {
          unitSpeeds[$(el).prop('nodeName')] = $(el)
            .find('speed')
            .text()
            .toNumber();
        });

      localStorage.setItem(
        'WallGod_unitSpeeds',
        JSON.stringify(unitSpeeds)
      );
    });
  };

  const getUnitSpeeds = function () {
    return JSON.parse(localStorage.getItem('WallGod_unitSpeeds')) || false;
  };

  if (!getUnitSpeeds()) setUnitSpeeds();

  const determineNextPage = function (page, $html) {
    let villageLength =
      $html.find('#scavenge_mass_screen').length > 0
        ? $html.find('tr[id*="scavenge_village"]').length
        : $html.find('tr.row_a, tr.row_ax, tr.row_b, tr.row_bx').length;
    let navSelect = $html
      .find('.paged-nav-item')
      .first()
      .closest('td')
      .find('select')
      .first();
    // FIX: this used to read the page count from `$('#plunder_list_nav')`,
    // which queries the live, currently-open browser tab rather than the
    // page we just fetched via ajax. The script never reloads the visible
    // tab while running, so that live nav widget stays frozen at whatever
    // it showed before the run started - if it was stale or reflected a
    // different filtered count, pagination stopped early and silently
    // dropped every walled village sitting on later pages. Reading it
    // from $html (the page actually just fetched) fixes that.
    let $navItems = $html
      .find('#plunder_list_nav')
      .first()
      .find('a.paged-nav-item, strong.paged-nav-item');
    let navLength =
      $html.find('#am_widget_Farm').length > 0
        ? $navItems.length > 0
          ? parseInt(
            $navItems[$navItems.length - 1].textContent.replace(/\D/g, '')
          ) - 1
          : 0
        : navSelect.length > 0
          ? navSelect.find('option').length - 1
          : $html.find('.paged-nav-item').not('[href*="page=-1"]').length;
    let pageSize =
      $('#mobileHeader').length > 0
        ? 10
        : parseInt($html.find('input[name="page_size"]').val());

    if (page == -1 && villageLength == 1000) {
      return Math.floor(1000 / pageSize);
    } else if (page < navLength) {
      return page + 1;
    }

    return false;
  };

  const processPage = function (url, page, wrapFn) {
    let pageText = url.match('am_farm')
      ? `&Farm_page=${page}`
      : `&page=${page}`;

    return twLib
      .ajax({
        url: url + pageText,
      })
      .then((html) => {
        return wrapFn(page, $(html));
      });
  };

  const processAllPages = function (url, processorFn) {
    let page = url.match('am_farm') || url.match('scavenge_mass') ? 0 : -1;
    let wrapFn = function (page, $html) {
      let dnp = determineNextPage(page, $html);

      if (dnp) {
        processorFn($html);
        return processPage(url, dnp, wrapFn);
      } else {
        return processorFn($html);
      }
    };

    return processPage(url, page, wrapFn);
  };

  // NEW: same page-walking logic as processAllPages, but stops once
  // `maxPages` pages have been fetched instead of always exhausting the
  // full farm list. maxPages <= 0 means "no cap" (behaves like
  // processAllPages). Used only for the farm-list scan, since that list
  // can be very long; the player's own village/command overviews still
  // use the unlimited processAllPages above.
  const processAllPagesLimited = function (url, processorFn, maxPages) {
    let page = url.match('am_farm') || url.match('scavenge_mass') ? 0 : -1;
    let pagesFetched = 0;

    let wrapFn = function (page, $html) {
      pagesFetched++;
      processorFn($html);

      let dnp = determineNextPage(page, $html);
      let capped = maxPages > 0 && pagesFetched >= maxPages;

      if (dnp !== false && !capped) {
        return processPage(url, dnp, wrapFn);
      }

      return $.Deferred().resolve().promise();
    };

    return processPage(url, page, wrapFn);
  };

  const getDistance = function (origin, target) {
    let a = origin.toCoord(true).x - target.toCoord(true).x;
    let b = origin.toCoord(true).y - target.toCoord(true).y;

    return Math.hypot(a, b);
  };

  const subtractArrays = function (array1, array2) {
    let result = array1.map((val, i) => {
      return val - array2[i];
    });

    return result.some((v) => v < 0) ? false : result;
  };

  const getCurrentServerTime = function () {
    let [hour, min, sec, day, month, year] = $('#serverTime')
      .closest('p')
      .text()
      .match(/\d+/g);
    return new Date(year, month - 1, day, hour, min, sec).getTime();
  };

  const timestampFromString = function (timestr) {
    let d = $('#serverDate')
      .text()
      .split('/')
      .map((x) => +x);
    let todayPattern = new RegExp(
      window.lang['aea2b0aa9ae1534226518faaefffdaad'].replace(
        '%s',
        '([\\d+|:]+)'
      )
    ).exec(timestr);
    let tomorrowPattern = new RegExp(
      window.lang['57d28d1b211fddbb7a499ead5bf23079'].replace(
        '%s',
        '([\\d+|:]+)'
      )
    ).exec(timestr);
    let laterDatePattern = new RegExp(
      window.lang['0cb274c906d622fa8ce524bcfbb7552d']
        .replace('%1', '([\\d+|\\.]+)')
        .replace('%2', '([\\d+|:]+)')
    ).exec(timestr);
    let t, date;

    if (todayPattern !== null) {
      t = todayPattern[1].split(':');
      date = new Date(d[2], d[1] - 1, d[0], t[0], t[1], t[2], t[3] || 0);
    } else if (tomorrowPattern !== null) {
      t = tomorrowPattern[1].split(':');
      date = new Date(
        d[2],
        d[1] - 1,
        d[0] + 1,
        t[0],
        t[1],
        t[2],
        t[3] || 0
      );
    } else {
      d = (laterDatePattern[1] + d[2]).split('.').map((x) => +x);
      t = laterDatePattern[2].split(':');
      date = new Date(d[2], d[1] - 1, d[0], t[0], t[1], t[2], t[3] || 0);
    }

    return date.getTime();
  };

  String.prototype.toCoord = function (objectified) {
    let c = (this.match(/\d{1,3}\|\d{1,3}/g) || [false]).pop();
    return c && objectified
      ? { x: c.split('|')[0], y: c.split('|')[1] }
      : c;
  };

  String.prototype.toNumber = function () {
    return parseFloat(this);
  };

  Number.prototype.toNumber = function () {
    return parseFloat(this);
  };

  return {
    getUnitSpeeds,
    processPage,
    processAllPages,
    processAllPagesLimited,
    getDistance,
    subtractArrays,
    getCurrentServerTime,
    timestampFromString,
  };
})();

window.WallGod.Translation = (function () {
  const msg = {
    nl_NL: {
      missingFeatures:
        'Script vereist een premium account en farm assistent!',
      options: {
        title: 'WallGod - Muren Breken',
        warning:
          '<b>Waarschuwingen:</b><br>- Zorg dat sjabloon B genoeg rammen/katapulten bevat om de muur te breken<br>- Doelen worden nu geselecteerd op basis van het daadwerkelijk gerapporteerde muurniveau (overgenomen van Clear Barbarian Walls), niet enkel de rapportkleur - zorg dat je farm-filters de gewenste rapporten nog steeds tonen<br>- Een lager aantal "Maximaal aantal pagina\'s" is sneller, maar kan verder weg gelegen ommuurde dorpen missen',
        group: 'Uit welke groep moet er gefarmd worden:',
        distance: 'Maximaal aantal velden dat farms mogen lopen:',
        maxPages: "Maximaal aantal Farm Assistent pagina's om op te halen (dichtstbijzijnde eerst):",
        button: 'Plan muur-farms (B)',
      },
      table: {
        noFarmsPlanned:
          'Er zijn geen dorpen met een muur gevonden om te plannen.',
        origin: 'Oorsprong',
        target: 'Doel',
        wall: 'Muur',
        fields: 'Velden',
        farm: 'Farm',
        goTo: 'Ga naar',
        reason: 'Reden',
        skippedHeader: 'Gevonden doelen zonder geschikte oorsprong',
        reasons: {
          too_far: 'Geen dorp binnen bereik',
          no_troops: 'Niet genoeg troepen',
          no_siege: 'Niet genoeg rammen/katapulten',
          time_conflict: 'Aankomst botst met lopend bevel',
          unknown: 'Onbekend',
        },
      },
      messages: {
        villageChanged: 'Succesvol van dorp veranderd!',
        villageError:
          'Alle farms voor het huidige dorp zijn reeds verstuurd!',
        sendError: 'Error: farm niet verstuurd!',
      },
    },
    hu_HU: {
      missingFeatures:
        'A scriptnek szüksége van Prémium fiókra és Farmkezelőre!',
      options: {
        title: 'WallGod - Falak lerombolása',
        warning:
          '<b>Figyelem:</b><br>- Bizonyosodj meg róla, hogy a "B" sablon elegendő faltörővel/katapulttal rendelkezik a fal lerombolásához<br>- A célpontokat mostantól a ténylegesen jelentett fal-szint alapján választja ki a script (a Clear Barbarian Walls scriptből átvéve), nem csak a jelentés színe alapján - ellenőrizd, hogy a farm-filtereid még mindig megjelenítik a kívánt jelentéseket<br>- Az "Oldalak maximális száma" csökkentése gyorsabb, de lemaradhatnak róla a távolabbi, még fallal rendelkező falvak',
        group: 'Ebből a csoportból küldje:',
        distance: 'Maximális mező távolság:',
        maxPages: 'Lekérdezendő Farm Segéd oldalak maximális száma (legközelebbi elsőként):',
        button: 'Fal-farmok tervezése (B)',
      },
      table: {
        noFarmsPlanned:
          'Nem található fallal rendelkező falu a tervezéshez.',
        origin: 'Origin',
        target: 'Célpont',
        wall: 'Fal',
        fields: 'Távolság',
        farm: 'Farm',
        goTo: 'Go to',
        reason: 'Ok',
        skippedHeader: 'Talált célpontok elérhető induló falu nélkül',
        reasons: {
          too_far: 'Nincs falu hatótávolságon belül',
          no_troops: 'Nincs elég csapat',
          no_siege: 'Nincs elég faltörő/katapult',
          time_conflict: 'Az érkezés ütközik egy folyamatban lévő paranccsal',
          unknown: 'Ismeretlen',
        },
      },
      messages: {
        villageChanged: 'Falu sikeresen megváltoztatva!',
        villageError: 'Minden farm kiment a jelenlegi faluból!',
        sendError: 'Hiba: Farm nemvolt elküldve!',
      },
    },
    de_DE: {
      missingFeatures:
        'Das Skript benötigt einen Premium-Account und den Farm-Assistenten!',
      options: {
        title: 'WallGod - Wall brechen',
        warning:
          '<b>Warnung:</b><br>- Stelle sicher, dass Vorlage B genügend Rammböcke/Katapulte enthält, um den Wall zu zerstören<br>- Ziele werden jetzt anhand des tatsächlich gemeldeten Wall-Levels ausgewählt (übernommen von Clear Barbarian Walls), nicht mehr nur anhand der Berichtsfarbe - stelle sicher, dass deine Farm-Filter die gewünschten Berichte weiterhin anzeigen<br>- Eine niedrigere "Maximale Seitenanzahl" ist schneller, kann aber weiter entfernte, noch ummauerte Dörfer übersehen',
        group: 'Aus welcher Gruppe soll gefarmt werden:',
        distance: 'Maximale Entfernung in Feldern:',
        maxPages: 'Maximale Anzahl an Farm-Assistent-Seiten (nächste zuerst):',
        button: 'Wall-Farmen berechnen (B)',
      },
      table: {
        noFarmsPlanned:
          'Es wurden keine Dörfer mit einem Wall gefunden.',
        origin: 'Herkunft',
        target: 'Ziel',
        wall: 'Wall',
        fields: 'Felder',
        farm: 'Farm',
        goTo: 'Wechseln zu',
        reason: 'Grund',
        skippedHeader: 'Gefundene Ziele ohne passenden Ursprung',
        reasons: {
          too_far: 'Kein Dorf in Reichweite',
          no_troops: 'Nicht genug Truppen',
          no_siege: 'Nicht genug Rammböcke/Katapulte',
          time_conflict: 'Ankunft kollidiert mit laufendem Befehl',
          unknown: 'Unbekannt',
        },
      },
      messages: {
        villageChanged: 'Dorf erfolgreich gewechselt!',
        villageError:
          'Alle Farmen für das aktuelle Dorf wurden bereits verschickt!',
        sendError: 'Fehler: Farm nicht verschickt!',
      },
    },
    int: {
      missingFeatures:
        'Script requires a premium account and loot assistent!',
      options: {
        title: 'WallGod - Clear Walls',
        warning:
          '<b>Warning:</b><br>- Make sure template B is loaded with enough rams/catapults to break the wall<br>- Targets are now selected by their actual reported wall level (borrowed from Clear Barbarian Walls), not just the report color - make sure your farm filters still show the reports you want scanned<br>- Lowering "Maximum FA pages" speeds up scanning but may miss walled villages further down the (distance-sorted) list',
        group: 'Send farms from group:',
        distance: 'Maximum fields for farms:',
        maxPages: 'Maximum FA pages to fetch (nearest first):',
        button: 'Plan wall-clear farms (B)',
      },
      table: {
        noFarmsPlanned:
          'No villages with a wall were found to plan.',
        origin: 'Origin',
        target: 'Target',
        wall: 'Wall',
        fields: 'fields',
        farm: 'Farm',
        goTo: 'Go to',
        reason: 'Reason',
        skippedHeader: 'Targets found without an available origin',
        reasons: {
          too_far: 'No village in range',
          no_troops: 'Not enough troops',
          no_siege: 'Not enough rams/catapults',
          time_conflict: 'Arrival conflicts with an existing command',
          unknown: 'Unknown',
        },
      },
      messages: {
        villageChanged: 'Successfully changed village!',
        villageError:
          'All farms for the current village have been sent!',
        sendError: 'Error: farm not send!',
      },
    },
  };

  const get = function () {
    let lang = msg.hasOwnProperty(game_data.locale)
      ? game_data.locale
      : 'int';
    return msg[lang];
  };

  return {
    get,
  };
})();

window.WallGod.Main = (function (Library, Translation) {
  const lib = Library;
  const t = Translation.get();
  let curVillage = null;
  let farmBusy = false;

  const init = function () {
    if (
      game_data.features.Premium.active &&
      game_data.features.FarmAssistent.active
    ) {
      if (game_data.screen == 'am_farm') {
        $.when(buildOptions()).then((html) => {
          Dialog.show('WallGod', html);

          $('.optionButton')
            .off('click')
            .on('click', () => {
              let optionGroup = parseInt($('.optionGroup').val());
              let optionDistance = parseFloat(
                $('.optionDistance').val()
              );
              let optionMaxPages =
                parseInt($('.optionMaxPages').val()) || 0;

              localStorage.setItem(
                'wallGod_options',
                JSON.stringify({
                  optionGroup: optionGroup,
                  optionDistance: optionDistance,
                  optionMaxPages: optionMaxPages,
                })
              );

              $('.optionsContent').html(
                UI.Throbber[0].outerHTML + '<br><br>'
              );
              getData(optionGroup, optionMaxPages).then((data) => {
                Dialog.close();

                let plan = createPlanning(
                  optionDistance,
                  data
                );
                // FIX: remove the skipped-targets block too, not just the
                // main plan table, otherwise re-running the planner stacks
                // duplicate "skipped" tables underneath each other.
                $('.wallGodContent, .wallGodSkipped').remove();
                $('#am_widget_Farm')
                  .first()
                  // FIX: pass the whole plan (farms + skipped), not just
                  // plan.farms, so buildTable can render both tables.
                  .before(buildTable(plan));

                bindEventHandlers();
                UI.InitProgressBars();
                UI.updateProgressBar(
                  $('#WallGodProgessbar'),
                  0,
                  plan.counter
                );
                $('#WallGodProgessbar')
                  .data('current', 0)
                  .data('max', plan.counter);
              });
            });

          document.querySelector('.optionButton').focus();
        });
      } else {
        location.href = game_data.link_base_pure + 'am_farm';
      }
    } else {
      UI.ErrorMessage(t.missingFeatures);
    }
  };

  const bindEventHandlers = function () {
    $('.wallGod_icon')
      .off('click')
      .on('click', function () {
        if (
          game_data.market != 'nl' ||
          $(this).data('origin') == curVillage
        ) {
          sendFarm($(this));
        } else {
          UI.ErrorMessage(t.messages.villageError);
        }
      });

    $(document)
      .off('keydown')
      .on('keydown', (event) => {
        if ((event.keyCode || event.which) == 13) {
          $('.wallGod_icon').first().trigger('click');
        }
      });

    $('.switchVillage')
      .off('click')
      .on('click', function () {
        curVillage = $(this).data('id');
        UI.SuccessMessage(t.messages.villageChanged);
        $(this).closest('tr').remove();
      });
  };

  const buildOptions = function () {
    let options = JSON.parse(localStorage.getItem('wallGod_options')) || {
      optionGroup: 0,
      optionDistance: 25,
      optionMaxPages: 20,
    };

    return $.when(buildGroupSelect(options.optionGroup)).then(
      (groupSelect) => {
        return `<style>#popup_box_WallGod{text-align:center;width:550px;}</style>
                <h3>${t.options.title}</h3><br><div class="optionsContent">
                <div class="info_box" style="line-height: 15px;font-size:10px;text-align:left;"><p style="margin:0px 5px;">${t.options.warning}</p></div><br>
                <div style="width:90%;margin:auto;background: url(\'graphic/index/main_bg.jpg\') 100% 0% #E3D5B3;border: 1px solid #7D510F;border-collapse: separate !important;border-spacing: 0px !important;"><table class="vis" style="width:100%;text-align:left;font-size:11px;">
                  <tr><td>${t.options.group}</td><td>${groupSelect}</td></tr>
                  <tr><td>${t.options.distance
          }</td><td><input type="text" size="5" class="optionDistance" value="${options.optionDistance
          }"></td></tr>
                  <tr><td>${t.options.maxPages
          }</td><td><input type="text" size="5" class="optionMaxPages" value="${options.optionMaxPages || 20
          }"></td></tr>
                </table></div><br><input type="button" class="btn optionButton" value="${t.options.button
          }"></div>`;
      }
    );
  };

  const buildGroupSelect = function (id) {
    return $.get(
      TribalWars.buildURL('GET', 'groups', { ajax: 'load_group_menu' })
    ).then((groups) => {
      let html = `<select class="optionGroup">`;

      groups.result.forEach((val) => {
        if (val.type == 'separator') {
          html += `<option disabled=""/>`;
        } else {
          html += `<option value="${val.group_id}" ${val.group_id == id ? 'selected' : ''
            }>${val.name}</option>`;
        }
      });

      html += `</select>`;

      return html;
    });
  };

  // FIX: now takes the full plan object ({farms, skipped, counter})
  // instead of just plan.farms, so it can render the diagnostic
  // "skipped" table beneath the normal plan. Both tables now also show
  // the reported wall level (new).
  const buildTable = function (plan) {
    let html = `<div class="vis wallGodContent"><h4>WallGod - Clear Walls</h4><table class="vis" width="100%">
                <tr><div id="WallGodProgessbar" class="progress-bar live-progress-bar progress-bar-alive" style="width:98%;margin:5px auto;"><div style="background: rgb(146, 194, 0);"></div><span class="label" style="margin-top:0px;"></span></div></tr>
                <tr><th style="text-align:center;">${t.table.origin}</th><th style="text-align:center;">${t.table.target}</th><th style="text-align:center;">${t.table.wall}</th><th style="text-align:center;">${t.table.fields}</th><th style="text-align:center;">${t.table.farm}</th></tr>`;

    if (!$.isEmptyObject(plan.farms)) {
      for (let prop in plan.farms) {
        if (game_data.market == 'nl') {
          html += `<tr><td colspan="5" style="background: #e7d098;"><input type="button" class="btn switchVillage" data-id="${plan.farms[prop][0].origin.id}" value="${t.table.goTo} ${plan.farms[prop][0].origin.name} (${plan.farms[prop][0].origin.coord})" style="float:right;"></td></tr>`;
        }

        plan.farms[prop].forEach((val, i) => {
          html += `<tr class="farmRow row_${i % 2 == 0 ? 'a' : 'b'}">
                    <td style="text-align:center;"><a href="${game_data.link_base_pure
            }info_village&id=${val.origin.id}">${val.origin.name} (${val.origin.coord
            })</a></td>
                    <td style="text-align:center;"><a href="${game_data.link_base_pure
            }info_village&id=${val.target.id}">${val.target.coord
            }</a></td>
                    <td style="text-align:center;">${val.wall}</td>
                    <td style="text-align:center;">${val.fields.toFixed(2)}</td>
                    <td style="text-align:center;"><a href="#" data-origin="${val.origin.id
            }" data-target="${val.target.id}" data-template="${val.template.id
            }" class="wallGod_icon farm_icon farm_icon_${val.template.name
            }" style="margin:auto;"></a></td>
                  </tr>`;
        });
      }
    } else {
      html += `<tr><td colspan="5" style="text-align: center;">${t.table.noFarmsPlanned}</td></tr>`;
    }

    html += `</table></div>`;

    // FIX: render targets that had a wall standing but couldn't be matched
    // to any origin, along with why. Previously these just vanished with
    // no trace, which is what made it look like the script "wasn't
    // finding" all walled villages.
    if (plan.skipped && plan.skipped.length > 0) {
      html += `<div class="vis wallGodSkipped" style="margin-top:5px;"><h4>${t.table.skippedHeader} (${plan.skipped.length})</h4><table class="vis" width="100%">
                <tr><th style="text-align:center;">${t.table.target}</th><th style="text-align:center;">${t.table.wall}</th><th style="text-align:center;">${t.table.reason}</th></tr>`;

      plan.skipped.forEach((s) => {
        html += `<tr><td style="text-align:center;"><a href="${game_data.link_base_pure}info_village&id=${s.id}">${s.target}</a></td><td style="text-align:center;">${s.wall}</td><td style="text-align:center;">${t.table.reasons[s.reason] || t.table.reasons.unknown
          }</td></tr>`;
      });

      html += `</table></div>`;
    }

    return html;
  };

  const getData = function (group, maxFaPages) {
    let data = {
      villages: {},
      commands: {},
      farms: { templates: {}, farms: {} },
    };

    let villagesProcessor = ($html) => {
      let skipUnits = ['ram', 'catapult', 'knight', 'snob', 'militia'];
      const mobileCheck = $('#mobileHeader').length > 0;

      if (mobileCheck) {
        let table = jQuery($html).find('.overview-container > div');
        table.each((i, el) => {
          try {
            const villageId = jQuery(el)
              .find('.quickedit-vn')
              .data('id');
            const name = jQuery(el)
              .find('.quickedit-label')
              .attr('data-text');
            const coord = jQuery(el)
              .find('.quickedit-label')
              .text()
              .toCoord();

            const units = new Array(game_data.units.length).fill(0);
            const unitsElements = jQuery(el).find(
              '.overview-units-row > div.unit-row-item'
            );

            unitsElements.each((_, unitElement) => {
              const img = jQuery(unitElement).find('img');
              const span =
                jQuery(unitElement).find('span.unit-row-name');
              if (img.length && span.length) {
                let unitType = img
                  .attr('src')
                  .split('unit_')[1]
                  .replace('@2x.webp', '')
                  .replace('.webp', '')
                  .replace('.png', '');
                const value = parseInt(span.text()) || 0;
                const unitIndex =
                  game_data.units.indexOf(unitType);
                if (unitIndex !== -1) {
                  units[unitIndex] = value;
                }
              }
            });

            const filteredUnits = units.filter(
              (_, index) =>
                skipUnits.indexOf(game_data.units[index]) === -1
            );

            const siege = {};
            ['ram', 'catapult'].forEach((unit) => {
              const idx = game_data.units.indexOf(unit);
              siege[unit] = idx !== -1 ? units[idx] || 0 : 0;
            });

            data.villages[coord] = {
              name: name,
              id: villageId,
              units: filteredUnits,
              siege: siege,
            };
          } catch (e) {
            console.error('Error processing village data:', e);
          }
        });
      } else {
        $html
          .find('#combined_table')
          .find('.row_a, .row_b')
          .filter((i, el) => {
            return $(el).find('.bonus_icon_33').length == 0;
          })
          .map((i, el) => {
            let $el = $(el);
            let $qel = $el.find('.quickedit-label').first();

            let allUnits = $el
              .find('.unit-item')
              .map((index, element) => {
                return $(element).text().toNumber();
              })
              .get();

            let units = allUnits.filter((val, index) => {
              return skipUnits.indexOf(game_data.units[index]) == -1;
            });

            let siege = {};
            ['ram', 'catapult'].forEach((unit) => {
              let idx = game_data.units.indexOf(unit);
              siege[unit] = idx !== -1 ? allUnits[idx] || 0 : 0;
            });

            return (data.villages[$qel.text().toCoord()] = {
              name: $qel.data('text'),
              id: parseInt(
                $el.find('.quickedit-vn').first().data('id')
              ),
              units: units,
              siege: siege,
            });
          });
      }

      console.log('villages', data.villages);
      return data;
    };

    let commandsProcessor = ($html) => {
      $html
        .find('#commands_table')
        .find('.row_a, .row_ax, .row_b, .row_bx')
        .map((i, el) => {
          let $el = $(el);
          let coord = $el
            .find('.quickedit-label')
            .first()
            .text()
            .toCoord();

          if (coord) {
            if (!data.commands.hasOwnProperty(coord))
              data.commands[coord] = [];
            return data.commands[coord].push(
              Math.round(
                lib.timestampFromString(
                  $el.find('td').eq(2).text().trim()
                ) / 1000
              )
            );
          }
        });

      return data;
    };

    let farmProcessor = ($html) => {
      if ($.isEmptyObject(data.farms.templates)) {
        let unitSpeeds = lib.getUnitSpeeds();

        $html
          .find('form[action*="action=edit_all"]')
          .find('input[type="hidden"][name*="template"]')
          .closest('tr')
          .map((i, el) => {
            let $el = $(el);
            let $inputs = $el.find(
              'input[type="text"], input[type="number"]'
            );

            let siege = {};
            ['ram', 'catapult'].forEach((unit) => {
              let input = $inputs.filter((index, element) => {
                return (
                  $(element).attr('name').trim().split('[')[0] == unit
                );
              });
              siege[unit] =
                input.length > 0
                  ? input.first().val().toNumber() || 0
                  : 0;
            });

            return (data.farms.templates[
              $el
                .prev('tr')
                .find('a.farm_icon')
                .first()
                .attr('class')
                .match(/farm_icon_(.*)\s/)[1]
            ] = {
              id: $el
                .find(
                  'input[type="hidden"][name*="template"][name*="[id]"]'
                )
                .first()
                .val()
                .toNumber(),
              units: $inputs
                .map((index, element) => {
                  return $(element).val().toNumber();
                })
                .get(),
              siege: siege,
              speed: Math.max(
                ...$inputs
                  .map((index, element) => {
                    return $(element).val().toNumber() > 0
                      ? unitSpeeds[
                      $(element)
                        .attr('name')
                        .trim()
                        .split('[')[0]
                      ]
                      : 0;
                  })
                  .get()
              ),
            });
          });
      }

      $html
        .find('#plunder_list')
        .find('tr[id^="village_"]')
        .map((i, el) => {
          let $el = $(el);

          return (data.farms.farms[
            $el
              .find('a[href*="screen=report&mode=all&view="]')
              .first()
              .text()
              .toCoord()
          ] = {
            id: $el.attr('id').split('_')[1].toNumber(),
            // FIX: "red_blue" must be checked before "red"/"blue" - regex
            // alternation matches the first alternative that fits, and
            // "red" is itself a valid prefix match of "red_blue", so a
            // combined report was previously always mislabeled as "red".
            color: $el
              .find('img[src*="graphic/dots/"]')
              .attr('src')
              .match(/dots\/(red_blue|green|yellow|red|blue)/)[1],
            max_loot: $el.find('img[src*="max_loot/1"]').length > 0,
            // NEW: the reported wall level, straight from the "extended"
            // Farm Assistant view (see getData - the request URL passes
            // extended=1). This is the same column Clear Barbarian Walls
            // reads to size its attacks; here it's only used to decide
            // whether a target still needs clearing, not to size troops.
            // "?" means the wall has never been scouted.
            wall: $el.find('td').eq(6).text().trim(),
          });
        });

      return data;
    };

    // Borrowed from Clear Barbarian Walls: keep a target only if it still
    // looks like it has a wall standing, judged from the actual reported
    // wall level instead of just the report colour.
    //   - known wall level > 0            -> keep
    //   - unknown wall ("?") + not green  -> keep (never scouted, or the
    //                                        last attack didn't clear it)
    //   - unknown wall ("?") + green      -> drop (clean win with nothing
    //                                        further reported - nothing
    //                                        indicates a wall is left)
    //   - known wall level == 0           -> drop (wall's already down)
    let filterFarms = () => {
      data.farms.farms = Object.fromEntries(
        Object.entries(data.farms.farms).filter(([key, val]) => {
          if (!val.hasOwnProperty('wall')) return false;

          let wallNum = parseInt(val.wall);
          let wallKnown = !isNaN(wallNum);

          if (wallKnown) return wallNum > 0;
          return val.color != 'green';
        })
      );

      return data;
    };

    return Promise.all([
      lib.processAllPages(
        TribalWars.buildURL('GET', 'overview_villages', {
          mode: 'combined',
          group: group,
        }),
        villagesProcessor
      ),
      lib.processAllPages(
        TribalWars.buildURL('GET', 'overview_villages', {
          mode: 'commands',
          type: 'attack',
        }),
        commandsProcessor
      ),
      // NEW: extended=1 pulls in the wall-level column (same flag Clear
      // Barbarian Walls uses); order=distance&dir=asc sorts nearest-first
      // so a page cap drops the farthest targets, not random ones;
      // processAllPagesLimited stops after maxFaPages pages (0/blank =
      // unlimited, same as the old behaviour).
      lib.processAllPagesLimited(
        TribalWars.buildURL('GET', 'am_farm', {
          extended: 1,
          order: 'distance',
          dir: 'asc',
        }),
        farmProcessor,
        maxFaPages
      ),
    ])
      .then(filterFarms)
      .then(() => {
        return data;
      });
  };

  const createPlanning = function (optionDistance, data) {
    // Hidden safety gap: if a target already has a command (from an earlier
    // run, e.g. after a misclick or an aborted run) landing within this many
    // minutes of a newly calculated arrival, skip it and try the next
    // nearest origin instead of stacking a second B attack on top of it.
    // Not exposed in the UI on purpose.
    const INC_GAP_MINUTES = 10;

    // FIX: added "skipped" so unmatched targets are tracked with a reason
    // instead of silently disappearing.
    let plan = { counter: 0, farms: {}, skipped: [] };
    let serverTime = Math.round(lib.getCurrentServerTime() / 1000);
    let maxTimeDiff = Math.round(INC_GAP_MINUTES * 60);

    // Checks whether a village has enough siege weapons (rams AND
    // catapults) for the template. These aren't in the normal units list
    // (see skipUnits) so they're compared separately.
    const hasSiege = (village, template) => {
      return ['ram', 'catapult'].every((unit) => {
        return (
          ((village.siege && village.siege[unit]) || 0) >=
          ((template.siege && template.siege[unit]) || 0)
        );
      });
    };

    // Deducts the siege weapons that were just planned from the village so
    // they can't be planned a second time for a different target.
    const subtractSiege = (village, template) => {
      ['ram', 'catapult'].forEach((unit) => {
        if (village.siege) {
          village.siege[unit] =
            (village.siege[unit] || 0) -
            ((template.siege && template.siege[unit]) || 0);
        }
      });
    };

    if (!data.farms.templates.hasOwnProperty('b')) {
      // No "B" template configured in the farm manager - nothing to plan.
      return plan;
    }

    let templateB = data.farms.templates['b'];

    // data.farms.farms has already been filtered down to targets that still
    // look walled (see filterFarms). For each one, find the nearest village
    // that has enough troops + siege for template B, whose calculated
    // arrival doesn't land within INC_GAP_MINUTES of an already in-flight
    // command to that target, and send it. If no origin qualifies, the
    // target is recorded in plan.skipped with the reason the *nearest*
    // origin failed, instead of just being dropped.
    Object.keys(data.farms.farms).forEach((targetCoord) => {
      let orderedOrigins = Object.keys(data.villages)
        .map((originCoord) => {
          return {
            coord: originCoord,
            dis: lib.getDistance(originCoord, targetCoord),
          };
        })
        .sort((a, b) => (a.dis > b.dis ? 1 : -1));

      let matched = false;
      let reason = null;

      for (let i = 0; i < orderedOrigins.length; i++) {
        let originCoord = orderedOrigins[i].coord;
        let distance = orderedOrigins[i].dis;

        // FIX: origins are sorted nearest-first, so once one is out of
        // range every remaining one is too - break instead of continuing
        // to scan (and this also fixes the reason ending up as whatever
        // the last, farthest origin happened to fail on).
        if (distance >= optionDistance) {
          if (!reason) reason = 'too_far';
          break;
        }

        let unitsLeft = lib.subtractArrays(
          data.villages[originCoord].units,
          templateB.units
        );
        if (!unitsLeft) {
          if (!reason) reason = 'no_troops';
          continue;
        }

        if (!hasSiege(data.villages[originCoord], templateB)) {
          if (!reason) reason = 'no_siege';
          continue;
        }

        let arrival = Math.round(
          serverTime +
          distance * templateB.speed * 60 +
          Math.round(plan.counter / 5)
        );
        let timeDiff = true;

        if (data.commands.hasOwnProperty(targetCoord)) {
          data.commands[targetCoord].forEach((timestamp) => {
            if (Math.abs(timestamp - arrival) < maxTimeDiff) {
              timeDiff = false;
            }
          });
        } else {
          data.commands[targetCoord] = [];
        }

        if (!timeDiff) {
          if (!reason) reason = 'time_conflict';
          continue;
        }

        plan.counter++;
        if (!plan.farms.hasOwnProperty(originCoord)) {
          plan.farms[originCoord] = [];
        }

        plan.farms[originCoord].push({
          origin: {
            coord: originCoord,
            name: data.villages[originCoord].name,
            id: data.villages[originCoord].id,
          },
          target: {
            coord: targetCoord,
            id: data.farms.farms[targetCoord].id,
          },
          wall: data.farms.farms[targetCoord].wall,
          fields: distance,
          template: { name: 'b', id: templateB.id },
        });

        data.villages[originCoord].units = unitsLeft;
        subtractSiege(data.villages[originCoord], templateB);
        data.commands[targetCoord].push(arrival);

        matched = true;
        // One B run per walled target per planning pass is enough to
        // clear the wall - move on to the next target.
        break;
      }

      if (!matched) {
        plan.skipped.push({
          target: targetCoord,
          id: data.farms.farms[targetCoord].id,
          wall: data.farms.farms[targetCoord].wall,
          reason: reason || 'no_troops',
        });
      }
    });

    return plan;
  };

  const sendFarm = function ($this) {
    let n = Timing.getElapsedTimeSinceLoad();
    if (
      !farmBusy &&
      !(
        Accountmanager.farm.last_click &&
        n - Accountmanager.farm.last_click < 200
      )
    ) {
      farmBusy = true;
      Accountmanager.farm.last_click = n;
      let $pb = $('#WallGodProgessbar');

      TribalWars.post(
        Accountmanager.send_units_link.replace(
          /village=(\d+)/,
          'village=' + $this.data('origin')
        ),
        null,
        {
          target: $this.data('target'),
          template_id: $this.data('template'),
          source: $this.data('origin'),
        },
        function (r) {
          UI.SuccessMessage(r.success);
          $pb.data('current', $pb.data('current') + 1);
          UI.updateProgressBar(
            $pb,
            $pb.data('current'),
            $pb.data('max')
          );
          $this.closest('.farmRow').remove();
          farmBusy = false;
        },
        function (r) {
          UI.ErrorMessage(r || t.messages.sendError);
          $pb.data('current', $pb.data('current') + 1);
          UI.updateProgressBar(
            $pb,
            $pb.data('current'),
            $pb.data('max')
          );
          $this.closest('.farmRow').remove();
          farmBusy = false;
        }
      );
    }
  };

  return {
    init,
  };
})(window.WallGod.Library, window.WallGod.Translation);

(() => {
  window.WallGod.Main.init();
})();
