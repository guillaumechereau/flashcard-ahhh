
// Copyright 2014 Guillaume Chereau <guillaume@noctua-software.com>
//
// This program is free software; you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation; either version 2 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

$(document).ready(function() {

    var g_online = null;
    var g_resources = null;
    var g_decks = null;
    var g_deck = null;
    var g_card = null;
    var g_finished = false;

    function startWithResource(res) {
        console.debug(res);
        if (res.decks.length == 0) {
            res.decks = {'default': {'name': 'default', 'cards': []}};
        }
        g_resources = res;
        g_decks = res.decks;
        g_deck = null;

        // Add the top bar with all the decks, also use the first deck.
        $.each(g_decks, function(deck) {
            if (g_deck === null) g_deck = g_decks[deck];
            var deckElem = $("<a href='#'/>").text(deck + " ");
            deckElem.click(function() {setDeck(deck);});
            $("#decks").append(deckElem);
        });

        localStorage.setItem("resources", JSON.stringify(g_resources));
        // Setup button callbacks.
        $('#flashcard #question .btn-primary').click(showAnswer);
        $('#flashcard #answer .btn-success').click(function() {onResult(true)});
        $('#flashcard #answer .btn-warning').click(function() {onResult(false)});
        $('#new-card #add-button').click(onNewCardAddClicked);
        $('#new-card-button').click(onNewCardClicked);
        $('#edit-card-button').click(onEditCardClicked);
        $('#delete-card-button').click(onDeleteCardClicked);
        $('#export-button').click(onExportClicked);
        $('#import-input').change(onImport);
        $('#import-button').click(onImportClicked);
        nextCard();
    }

    function startWithOnlineResources(res) {
        console.debug("start with online resource");
        startWithResource(res);
    }

    function startOffline() {
        console.debug("start with offline resource");
        g_online = false;
        var res = JSON.parse(localStorage.getItem('resources'));
        startWithResource(res);
    }

    // Download the resources from the server and store them in the local
    // storage.
    function startOnline() {
        console.log("try to start online");
        var localRes = localStorage.getItem('resources');
        var data = {"resources": localRes};
        // getJson does not work very well on my iPhone in the offline case.
        // So I use ajax instead.
        $.ajax({
            url: "resources.json",
            dataType: "json",
            timeout: 5000,
            cache: false,
            data: data})
        .done(startWithOnlineResources)
        .fail(function() {
            alert("fail to get resource, using offline mode");
            startOffline();
        });
    }

    g_online = !navigator || navigator.onLine == true;
    if (!$('#flashcard').data('sync'))
        g_online = false;
    if (!g_online)
        startOffline();
    else
        startOnline();

    function setDeck(name) {
        g_deck = g_decks[name];
        g_finished = false;
        nextCard();
    }

    // Convert a date object to unix time.
    function toTime(x) {
        return (new Date(x)).getTime() / 1000;
    }

    // Return the optimal time to review a given card (in unix time).
    function optimalReviewTime(card) {
        if (!card.time) return null;
        var time = toTime(card.time);
        var level = card.level || 0;
        var k = 2;
        var interval = Math.pow(2, k * level - 1);
        return time + interval;
    }

    // Pick the best suited card from the deck.
    function pickCard() {
        // First search a ready card.
        var best = [-Infinity, null];
        var time = toTime(new Date());
        var i;
        var card;
        $.each(g_deck.cards, function(i, card) {
            if (card.deleted) return;
            var t = optimalReviewTime(card) - time;
            if (t === null || t > 0) return;  // Not ready yet.
            if (t < best[0]) return;
            best = [t, card];
        });
        if (best[1]) return best[1];
        // No card ready pick a new one.
        $.each(g_deck.cards, function(i, card) {
            if (card.deleted) return;
            if (!card.time) {
                best = [null, card];
                return false;
            }
        });
        // No new cards, pick the oldest card in the deck.
        console.debug("No ready or new card, pick oldest.");
        best = [time, null];
        $.each(g_deck.cards, function(i, card) {
            if (card.deleted) return;
            var t = toTime(card.time || time);
            if (t > best[0]) return;
            best = [t, card]
        });

        if (best[1])
            return best[1];

        // If everything else fails, we create a dummy card.
        return {"q": "1 + 2 = ?", "a": "3"};
    }

    function nextCard() {
        g_card = pickCard();
        if (!g_finished && optimalReviewTime(g_card) > toTime(new Date())) {
            alert("finished");
            g_finished = true;
        }
        showCard();
    }

    function showCard() {
        $('#flashcard #question').show();
        $('#flashcard #answer').hide();
        if (g_card === null) {
            alert("no more cards");
            return;
        }
        $('#flashcard #question .question-text').text(g_card.q);
        if (g_card.img) {
            var imgPath = "/decks/" + g_deck.name + "/" + g_card.img;
            $('#flashcard #question .image').attr('src', imgPath).show();
        } else {
            $('#flashcard #question .image').hide();
        }
    }

    function showAnswer() {
        $('#flashcard #question').hide();
        $('#flashcard #answer .question-text').text(g_card.a);
        $('#flashcard #answer').show();
    }

    function onResult(correct) {
        var level = g_card.level || 0;
        var time = new Date();
        if (!correct) {
            g_card.level = Math.floor(level / 2);
        } else if (optimalReviewTime(g_card) <= toTime(time)) {
            console.log("increase card level", optimalReviewTime(g_card), time);
            g_card.level = level + 1;
        }
        g_card.time= time;
        saveCard();
        nextCard();
    }

    function saveCard(card) {
        if (card === undefined)
            card = g_card;
        console.log("save card", card);
        if (card.q == "") card.deleted= true;
        if (g_online) {
            $.ajax({url: "update-card", contentType:'application/json',
                dataType: 'json',
                data: {"deck": g_deck.name, "card": JSON.stringify(card)}});
        }
        localStorage.setItem("resources", JSON.stringify(g_resources));
    }

    function deleteCard(card) {
        if (card === undefined)
            card = g_card;
        card.a = "";
        saveCard(card);
    }

    function onNewCardAddClicked() {
        g_card.q = $('#new-card #input-question').val();
        g_card.a = $('#new-card #input-answer').val();
        g_card.time = new Date();
        saveCard();
        $('#new-card').modal('hide');
        showCard();
    }

    function onNewCardClicked() {
        g_card = {'q': "", 'a': ""};
        g_deck.cards.push(g_card);
        onEditCardClicked();
    }

    function onEditCardClicked() {
        $('#new-card #input-question').val(g_card.q);
        $('#new-card #input-answer').val(g_card.a);
        $('#new-card').modal('show');
    }

    function onDeleteCardClicked() {
        g_card.deleted = true;
        saveCard();
        nextCard();
    }

    function saveToDisk(url, name) {
        var save = $("a").attr('href', url, 'download', name);
        save.trigger("click");
    }

    function onExportClicked() {
        var json = JSON.stringify(g_resources, null, 4);
        $(this).attr("href", "data:application/json;charset=utf-8," +
                             encodeURI(json));
    }

    function onImportClicked() {
        $('#import-input').click();
    }

    function mergeResource(res) {
        $.extend(true, g_resources, res);
        startWithResource(g_resources);
    }

    function onImport(evt) {
        console.log("import");
        var file = evt.target.files[0];
        var reader = new FileReader();
        reader.onload = function(ev) {
            var data = ev.target.result;
            var res = JSON.parse(data);
            mergeResource(res);
        };
        reader.readAsText(file);
    }
});


