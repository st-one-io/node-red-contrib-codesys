# Changelog

## 0.3.0
- Package renamed from `node-red-contrib-codesys-v2` to `node-red-contrib-codesys`, restructured (`red/codesys.js`, `red/codesys.html`, `red/locales/en-US/codesys.json`)
- Editor and messages in English
- Endpoint editor with *Connection* and *Variables* tabs, address validation, *Add* / *Remove all*, and CSV export/import of the variable list
- New **codesys control** node: change the cycle time on the fly or trigger a read
- **codesys in** shows the last value on the node status
- **codesys in** in mode *All variables* now sends `msg.topic = ""` (it was `"all"`)
- Connection handling moved to the library (`CodesysEndpoint` / `CodesysItemGroup`)
- License: ISC
- Variable names no longer collide with internal events (a variable named `error` used to break the read cycle)

## 0.2.0
- First version (`node-red-contrib-codesys-v2`): `codesys endpoint` and `codesys in` nodes, read-only
