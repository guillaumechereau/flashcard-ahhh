#!/usr/bin/python

# Copyright 2014 Guillaume Chereau <guillaume@noctua-software.com>
#
# This program is free software; you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation; either version 2 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.


# global configs for the server.
import config

import codecs
import hashlib
import jinja2
import json
import os
import re
import shutil
import sys
import web

jinja_environment = jinja2.Environment(
        loader=jinja2.FileSystemLoader(
            "%s/templates" % os.path.dirname(__file__)))

def create_deck_if_not_exists(name):
    assert re.match(r"^[a-zA-Z-0-9_-]*$", name)
    if not os.path.exists("decks"):
        os.mkdir("decks")
    if not os.path.exists("decks/%s" % name):
        os.mkdir("decks/%s" % name)
    if not os.path.exists("decks/%s/cards.json" % name):
        open("decks/%s/cards.json" % name, "w").write("[]")


def need_sync(func):
    """Decorator that raises a 404 if server sync is disabled"""
    def inner(self, *args, **kargs):
        if not config.sync:
            raise web.notfound()
        return func(self, *args, **kargs)
    return inner


class MainPageHandler:

    def GET(self):
        web.header('Content-type', "text/html; charset=utf-8")
        template = jinja_environment.get_template('index.html')
        template_values = {'sync': config.sync}
        return template.render(template_values)


class ManifestHandler:

    def GET(self):
        web.header('Content-type', "text/cache-manifest")
        md5 = hashlib.md5()
        lines = ['./']
        md5.update(open('templates/index.html').read())
        md5.update(open('flashcard-ahhh.py').read())

        # Add all the static and decks image files.
        exts = ['css', 'js', 'png', 'map', 'jpg']
        for top in ["static", "decks"]:
            for root, dirs, files in os.walk(top):
                for f in files:
                    if f.startswith('.'): continue
                    ext = f.split(".")[-1]
                    if ext not in exts: continue
                    path = "%s/%s" % (root, f)
                    lines.append(path)
                    md5.update(open(path).read())
        return "CACHE MANIFEST\n# md5: %s\n%s\n\nNETWORK:\n*" % (
                            md5.hexdigest(), "\n".join(lines))

def sync_deck(name, data):

    create_deck_if_not_exists(name)
    path = "decks/%s/cards.json" % name
    try:
        s_cards = json.load(codecs.open(path, "r", "utf-8"))
    except IOError:
        s_cards = []

    c_cards = data['cards']

    def find_s_card(q):
        r = [x for x in s_cards if x['q'] == q]
        return r[0] if r else None

    for c_card in c_cards:
        if 'time' not in c_card:
            continue
        s_card = find_s_card(c_card['q'])
        if not s_card:
            s_cards.append(c_card)
            continue
        if s_card.get('deleted'):
            continue
        if 'time' in s_card and s_card['time'] > c_card['time']:
            continue
        s_cards[s_cards.index(s_card)] = c_card

    s_cards = [x for x in s_cards if not x.get('deleted', False)]

    file = codecs.open(path, "w", "utf-8")
    json.dump(s_cards, file, indent=4, sort_keys=True, ensure_ascii=False)


class ResourcesHandler:

    @need_sync
    def GET(self):
        user_data = web.input()
        if user_data.resources:
            client_res = json.loads(user_data.resources)
            for deck in client_res['decks']:
                sync_deck(deck, client_res['decks'][deck])

        web.header('Content-type', "application/json")
        decks = {}
        if os.path.exists("decks"):
            for name in os.listdir("decks"):
                if name.startswith('.'):  # TODO: use regex?
                    continue
                path = "decks/%s/cards.json" % name
                cards = json.load(codecs.open(path, "r", "utf-8"))
                decks[name] = {'name': name, 'cards': cards}
        res = {'decks': decks}
        return json.dumps(res, indent=4, sort_keys=True)


class UpdateCardHandler:

    @need_sync
    def GET(self):
        user_data = web.input()
        create_deck_if_not_exists(user_data.deck)
        card = json.loads(user_data.card)
        path = "decks/%s/cards.json" % user_data.deck
        cards = json.loads(codecs.open(path, "r", "utf-8").read())
        for i, c in enumerate(cards):
            if c['q'] == card['q']:
                cards[i] = card
                break
        else:
            cards.append(card)
        file = codecs.open(path, "w", "utf-8")
        json.dump(cards, file, indent=4, sort_keys=True, ensure_ascii=False)
        return ""

class DeckFileHandler:

    @need_sync
    def GET(self, deck, name):
        ext = name.split(".")[-1]
        assert ext in ('png', 'jpg')
        web.header("Content-Type", "image/%s" % ext)
        path = "decks/%s/%s" % (deck, name)
        return open(path, "rb").read()


urls = (r'/', MainPageHandler,
        r'/cache.manifest', ManifestHandler,
        r'/resources.json', ResourcesHandler,
        r'/update-card', UpdateCardHandler,
        r'/decks/(.+)/(.+)', DeckFileHandler,
        )

def generate_standalone(path):
    """generate a standalone html version of the website"""
    print "generating a standalone version into %s" % path
    assert not os.path.exists(path)
    config.sync = False
    app = web.application(urls, globals())
    os.mkdir(path)
    shutil.copytree("static", "%s/static" % path)
    if os.path.exists("./decks"):
        shutil.copytree("decks", "%s/decks" % path)
    manifest = app.request("/cache.manifest").data
    open("%s/cache.manifest" % path, "w").write(manifest)
    index = app.request("/").data
    open("%s/flashcard-ahhh.html" % path, "w").write(index)


if __name__ == "__main__":

    if len(sys.argv) == 2:
        generate_standalone(sys.argv[1])
        sys.exit(0)

    config.sync = True
    app = web.application(urls, globals())
    app.run()

