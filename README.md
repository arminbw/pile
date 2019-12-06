# Pile
Pile is a lightweight Firefox add-on for the avid reader. It gives you a place where you can temporarily store links for later review. In contrast to other "read it later"-like solutions, it stores your bookmarks not in the cloud, but locally.

## Installation
Simply visit [addons.mozilla.org](https://addons.mozilla.org/en-US/firefox/addon/pile-lightweight-bookmarking/) and click on the "Add to Firefox" button.

## Building
```
npm install --global web-ext
npm install
npm run build
```

```
web-ext run --pref=browser.link.open_newwindow=3 --source-dir build --firefox=/Applications/Firefox.app/Contents/MacOS/firefox-bin --browser-console --verbose
```

## License
Pile has been licensed under the MIT license.