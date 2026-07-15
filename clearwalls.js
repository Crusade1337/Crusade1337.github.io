// Hungarian translation provided by =Krumpli=
//
// --- MODIFIED FORK: "Clear Walls" mode -----------------------------------
// This version no longer plans normal A/B farm runs across all targets.
// Instead it ONLY looks at targets that came back with a yellow (partial
// loss) or red/red_blue (full loss) report - i.e. villages that likely
// still have a wall standing - and sends your "B" template (which you
// pre-load with the ram/kata split you want in the Farm Manager) to the
// nearest available village that has enough troops + siege for it.
// Template "A" is no longer used by the planner at all. New-barbarian
// discovery has been removed since undiscovered/never-attacked villages
// don't have a report yet and can't be yellow/red.
// ---------------------------------------------------------------------------

ScriptAPI.register('WallGod', true, 'Warre', 'nl.tribalwars@coma.innogames.de');

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
    let navLength =
      $html.find('#am_widget_Farm').length > 0
        ? parseInt(
          $('#plunder_list_nav')
            .first()
            .find('a.paged-nav-item, strong.paged-nav-item')
          [
            $('#plunder_list_nav')
              .first()
              .find(
                'a.paged-nav-item, strong.paged-nav-item'
              ).length - 1
          ].textContent.replace(/\D/g, '')
        ) - 1
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
          '<b>Waarschuwingen:</b><br>- Zorg dat sjabloon B genoeg rammen/katapulten bevat om de muur te breken<br>- Zorg dat de farm filters rapporten met gedeeltelijke en volledige verliezen (geel/rood) tonen voor je het script gebruikt',
        group: 'Uit welke groep moet er gefarmd worden:',
        distance: 'Maximaal aantal velden dat farms mogen lopen:',
        button: 'Plan muur-farms (B)',
      },
      table: {
        noFarmsPlanned:
          'Er zijn geen dorpen met een gedeeltelijk of volledig verlies-rapport gevonden om te plannen.',
        origin: 'Oorsprong',
        target: 'Doel',
        fields: 'Velden',
        farm: 'Farm',
        goTo: 'Ga naar',
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
          '<b>Figyelem:</b><br>- Bizonyosodj meg róla, hogy a "B" sablon elegendő faltörővel/katapulttal rendelkezik a fal lerombolásához<br>- Bizonyosodj meg róla, hogy a farm-filterek megjelenítik a részleges és teljes veszteséges (sárga/piros) jelentéseket, mielőtt használod a scriptet',
        group: 'Ebből a csoportból küldje:',
        distance: 'Maximális mező távolság:',
        button: 'Fal-farmok tervezése (B)',
      },
      table: {
        noFarmsPlanned:
          'Nem található részleges vagy teljes veszteséges jelentésű falu a tervezéshez.',
        origin: 'Origin',
        target: 'Célpont',
        fields: 'Távolság',
        farm: 'Farm',
        goTo: 'Go to',
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
          '<b>Warnung:</b><br>- Stelle sicher, dass Vorlage B genügend Rammböcke/Katapulte enthält, um den Wall zu zerstören<br>- Stelle sicher, dass die Farm-Filter Berichte mit teilweisen und vollständigen Verlusten (gelb/rot) anzeigen, bevor du das Skript benutzt',
        group: 'Aus welcher Gruppe soll gefarmt werden:',
        distance: 'Maximale Entfernung in Feldern:',
        button: 'Wall-Farmen berechnen (B)',
      },
      table: {
        noFarmsPlanned:
          'Es wurden keine Dörfer mit einem Teil- oder Totalverlust-Bericht gefunden.',
        origin: 'Herkunft',
        target: 'Ziel',
        fields: 'Felder',
        farm: 'Farm',
        goTo: 'Wechseln zu',
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
          '<b>Warning:</b><br>- Make sure template B is loaded with enough rams/catapults to break the wall<br>- Make sure your farm filters show reports with partial and total losses (yellow/red) before using the script',
        group: 'Send farms from group:',
        distance: 'Maximum fields for farms:',
        button: 'Plan wall-clear farms (B)',
      },
      table: {
        noFarmsPlanned:
          'No villages with a yellow or red report were found to plan.',
        origin: 'Origin',
        target: 'Target',
        fields: 'fields',
        farm: 'Farm',
        goTo: 'Go to',
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

              localStorage.setItem(
                'wallGod_options',
                JSON.stringify({
                  optionGroup: optionGroup,
                  optionDistance: optionDistance,
                })
              );

              $('.optionsContent').html(
                UI.Throbber[0].outerHTML + '<br><br>'
              );
              getData(optionGroup).then((data) => {
                Dialog.close();

                let plan = createPlanning(
                  optionDistance,
                  data
                );
                $('.wallGodContent').remove();
                $('#am_widget_Farm')
                  .first()
                  .before(buildTable(plan.farms));

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

  const buildTable = function (plan) {
    let html = `<div class="vis wallGodContent"><h4>WallGod - Clear Walls</h4><table class="vis" width="100%">
                <tr><div id="WallGodProgessbar" class="progress-bar live-progress-bar progress-bar-alive" style="width:98%;margin:5px auto;"><div style="background: rgb(146, 194, 0);"></div><span class="label" style="margin-top:0px;"></span></div></tr>
                <tr><th style="text-align:center;">${t.table.origin}</th><th style="text-align:center;">${t.table.target}</th><th style="text-align:center;">${t.table.fields}</th><th style="text-align:center;">${t.table.farm}</th></tr>`;

    if (!$.isEmptyObject(plan)) {
      for (let prop in plan) {
        if (game_data.market == 'nl') {
          html += `<tr><td colspan="4" style="background: #e7d098;"><input type="button" class="btn switchVillage" data-id="${plan[prop][0].origin.id}" value="${t.table.goTo} ${plan[prop][0].origin.name} (${plan[prop][0].origin.coord})" style="float:right;"></td></tr>`;
        }

        plan[prop].forEach((val, i) => {
          html += `<tr class="farmRow row_${i % 2 == 0 ? 'a' : 'b'}">
                    <td style="text-align:center;"><a href="${game_data.link_base_pure
            }info_village&id=${val.origin.id}">${val.origin.name} (${val.origin.coord
            })</a></td>
                    <td style="text-align:center;"><a href="${game_data.link_base_pure
            }info_village&id=${val.target.id}">${val.target.coord
            }</a></td>
                    <td style="text-align:center;">${val.fields.toFixed(2)}</td>
                    <td style="text-align:center;"><a href="#" data-origin="${val.origin.id
            }" data-target="${val.target.id}" data-template="${val.template.id
            }" class="wallGod_icon farm_icon farm_icon_${val.template.name
            }" style="margin:auto;"></a></td>
                  </tr>`;
        });
      }
    } else {
      html += `<tr><td colspan="4" style="text-align: center;">${t.table.noFarmsPlanned}</td></tr>`;
    }

    html += `</table></div>`;

    return html;
  };

  const getData = function (group) {
    let data = {
      villages: {},
      commands: {},
      farms: { templates: {}, farms: {} },
    };
    // villagesProcessor, commandsProcessor and farmProcessor all run
    // concurrently (see Promise.all below), so commandsProcessor can't
    // safely check data.villages while it's still being filled in. It just
    // records the raw coordinates per row here instead; resolveCommands()
    // sorts out origin vs. target afterwards, once all villages are known.
    let rawCommandRows = [];

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
          // Just collect every coordinate-looking substring in the row plus
          // the arrival timestamp. We deliberately do NOT decide here which
          // one is the target - see resolveCommands() for why.
          let coords = $el.text().match(/\d{1,3}\|\d{1,3}/g) || [];

          if (coords.length) {
            rawCommandRows.push({
              coords: coords,
              timestamp: Math.round(
                lib.timestampFromString(
                  $el.find('td').eq(2).text().trim()
                ) / 1000
              ),
            });
          }
        });

      return data;
    };

    // Runs after Promise.all below, once data.villages is guaranteed to be
    // fully populated. For each scraped command row, whichever coordinate
    // ISN'T one of our own villages is the target - this works regardless
    // of row order, so it's correct for both outgoing and returning
    // commands, unlike an order-based ("last coordinate in the row") guess.
    let resolveCommands = () => {
      rawCommandRows.forEach(({ coords, timestamp }) => {
        let target = coords
          .slice()
          .reverse()
          .find((c) => !data.villages.hasOwnProperty(c));

        if (target) {
          if (!data.commands.hasOwnProperty(target))
            data.commands[target] = [];
          data.commands[target].push(timestamp);
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
            color: $el
              .find('img[src*="graphic/dots/"]')
              .attr('src')
              .match(/dots\/(green|yellow|red|blue|red_blue)/)[1],
            max_loot: $el.find('img[src*="max_loot/1"]').length > 0,
          });
        });

      return data;
    };

    // Only keep targets whose last report is a partial loss (yellow) or a
    // full loss (red / red_blue) - these are the villages that still have
    // a wall standing and need a "B" (ram/kata) run to clear it. Green,
    // blue and colorless (never-attacked / new barb) entries are dropped.
    let filterFarms = () => {
      data.farms.farms = Object.fromEntries(
        Object.entries(data.farms.farms).filter(([key, val]) => {
          return (
            val.hasOwnProperty('color') &&
            (val.color == 'yellow' ||
              val.color == 'red' ||
              val.color == 'red_blue')
          );
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
      lib.processAllPages(
        TribalWars.buildURL('GET', 'am_farm'),
        farmProcessor
      ),
    ])
      .then(resolveCommands)
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

    let plan = { counter: 0, farms: {} };
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

    // data.farms.farms has already been filtered down to yellow/red/red_blue
    // targets only. For each one, find the nearest village that has enough
    // troops + siege for template B, whose calculated arrival doesn't land
    // within INC_GAP_MINUTES of an already in-flight command to that
    // target, and send it.
    Object.keys(data.farms.farms).forEach((targetCoord) => {
      let orderedOrigins = Object.keys(data.villages)
        .map((originCoord) => {
          return {
            coord: originCoord,
            dis: lib.getDistance(originCoord, targetCoord),
          };
        })
        .sort((a, b) => (a.dis > b.dis ? 1 : -1));

      for (let i = 0; i < orderedOrigins.length; i++) {
        let originCoord = orderedOrigins[i].coord;
        let distance = orderedOrigins[i].dis;

        if (distance >= optionDistance) continue;

        let unitsLeft = lib.subtractArrays(
          data.villages[originCoord].units,
          templateB.units
        );
        if (!unitsLeft || !hasSiege(data.villages[originCoord], templateB))
          continue;

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

        if (!timeDiff) continue;

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
          fields: distance,
          template: { name: 'b', id: templateB.id },
        });

        data.villages[originCoord].units = unitsLeft;
        subtractSiege(data.villages[originCoord], templateB);
        data.commands[targetCoord].push(arrival);

        // One B run per yellow/red target per planning pass is enough to
        // clear the wall - move on to the next target.
        break;
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
