# node-red-contrib-codesys
A Node-RED node to read data from PLCs running a CoDeSys V2.3 runtime (e.g. PLCWinNT, ELAU PacDrive C400), using the native CoDeSys protocol (no Modbus, no OPC).

**Read-only:** the underlying library only allows the handshake, login, read list and logout services. Writing, start/stop and download are blocked, so there is no *out* node.

This node was created as part of the [ST-One](https://st-one.io) project.


## Usage

Each connection to a PLC is represented by the **CoDeSys Endpoint** configuration node. You can configure the PLC's address, port and byte order, the variables available and their addresses, and the cycle time for reading the variables.

| Target              | Port   | Byte order    |
| ------------------- | ------ | ------------- |
| PLCWinNT            | `1200` | Little-endian |
| ELAU PacDrive       | `5000` | Big-endian    |

When the connection is lost, a new attempt is made every 5 seconds.

The **CoDeSys In** node makes the variable's values available in a flow in three different modes:

*   **Single variable:** A single variable can be selected from the configured variables, and a message is sent every cycle, or only when it changes if _diff_ is checked. `msg.payload` contains the variable's value and `msg.topic` has the variable's name.
*   **All variables, one per message:** Like the _Single variable_ mode, but for all variables configured. If _diff_ is checked, a message is sent everytime any variable changes. If _diff_ is unchecked, one message is sent for every variable, in every cycle. Care must be taken about the number of messages per second in this mode.
*   **All variables:** In this mode, `msg.payload` contains an object with all configured variables and their values. If _diff_ is checked, a message is sent if at least one of the variables changes its value.

The **CoDeSys Control** node changes the cycle time on the fly (`msg.payload` in ms, `0` disables the cyclic read) or triggers a read cycle manually.


### Importing and exporting variables

The variable list of the endpoint can be exported to and imported from a CSV file (buttons *Export* / *Import* on the *Variables* tab). Each line has one variable, `address;name` (a tab also works as separator):

```
%MW38;line_speed
%MX1.9;machine_running
RAW:0:6272:4:UDINT;running_time
RAW:4:166:21:STRING;recipe_name
```

Importing replaces the current list.


### Variable addressing

| Address                   | JS Data type | Description |
| ------------------------- | ------------ | ----------- |
| `%MX1.9`                  | Boolean      | Bit 9 of word 1 of the memory area (bits 0-15) |
| `%MB5`                    | Number       | Byte 5 (0-255) of the memory area |
| `%MW38`                   | Number       | Unsigned 16-bit number (WORD) at word 38 of the memory area |
| `%MW38:INT`               | Number       | Signed 16-bit number at word 38 of the memory area |
| `%MD10`                   | Number       | Unsigned 32-bit number (DWORD) at double word 10 of the memory area |
| `%MD10:DINT`              | Number       | Signed 32-bit number at double word 10 of the memory area |
| `%MD10:REAL`              | Number       | Floating point 32-bit number at double word 10 of the memory area |
| `%MD10:TIME`              | Number       | TIME value, in milliseconds |
| `RAW:4:162:4:DINT`        | Number       | Signed 32-bit number at byte offset 162 of area 4 (POU data) |
| `RAW:0:6272:4:UDINT`      | Number       | Unsigned 32-bit number at byte offset 6272 of area 0 (same as `%MD1568:UDINT`) |
| `RAW:4:166:21:STRING`     | String       | 21 bytes at byte offset 166 of area 4, as a zero-terminated string |
| `%MW40:STRING(20)`        | String       | STRING(20) starting at word 40 (reads 21 bytes) |
| `RAW:4:200:8`             | String       | 8 raw bytes at byte offset 200 of area 4, as a hex string |

 - The `%` is optional (`MW38` also works).
 - Supported data types: `BOOL`, `BYTE`, `SINT`, `USINT`, `WORD`, `INT`, `UINT`, `DWORD`, `DINT`, `UDINT`, `REAL`, `TIME`, `STRING`, `STRING(n)`.
 - Area `0` is the memory area (`%M`). Variables declared without `AT` live in area `4`, at an offset defined by the compiler.
 - The PLC may report a variable as invalid (e.g. an address outside the area); its value is then `null`.


## License
Copyright: (c) 2026, ST-One Ltda.

ISC License (see https://opensource.org/license/isc-license-txt)
