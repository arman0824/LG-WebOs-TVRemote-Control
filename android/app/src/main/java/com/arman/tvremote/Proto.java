package com.arman.tvremote;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Only the bounded wire types used by Android TV Remote v2; no generated runtime. */
final class Proto {
    static byte[] join(byte[]... values) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (byte[] value : values) out.write(value, 0, value.length);
        return out.toByteArray();
    }
    static byte[] varint(int value) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        do { out.write((value & 127) | ((value & ~127) != 0 ? 128 : 0)); value >>>= 7; } while (value != 0);
        return out.toByteArray();
    }
    static byte[] number(int field, int value) { return join(varint(field * 8), varint(value)); }
    static byte[] bytes(int field, byte[] value) { return join(varint(field * 8 + 2), varint(value.length), value); }
    static byte[] text(int field, String value) { return bytes(field, value.getBytes(StandardCharsets.UTF_8)); }
    static int readVarint(InputStream input) throws IOException {
        int result = 0;
        for (int i = 0; i < 5; i++) {
            int b = input.read();
            if (b < 0) throw new EOFException("TV connection closed.");
            if (i == 4 && (b & 0xf0) != 0) throw new IOException("Invalid TV integer.");
            result |= (b & 127) << (i * 7);
            if ((b & 128) == 0) return result;
        }
        throw new IOException("Invalid TV integer.");
    }
    static byte[] readBytes(InputStream in, int length) throws IOException {
        if (length < 0 || length > 1048576) throw new IOException("TV message is too large.");
        byte[] bytes = new byte[length];
        new DataInputStream(in).readFully(bytes); return bytes;
    }
    static Map<Integer, Object> decode(byte[] data) throws IOException {
        ByteArrayInputStream in = new ByteArrayInputStream(data);
        Map<Integer, Object> fields = new HashMap<>();
        while (in.available() > 0) {
            int tag = readVarint(in), field = tag >>> 3, type = tag & 7;
            if (field == 0) throw new IOException("Invalid TV message.");
            if (type == 0) fields.put(field, readVarint(in));
            else if (type == 2) fields.put(field, readBytes(in, readVarint(in)));
            else if (type == 1 || type == 5) readBytes(in, type == 1 ? 8 : 4);
            else throw new IOException("Unsupported TV message encoding.");
        }
        return fields;
    }
    static int value(Map<Integer, Object> fields, int field) { Object value = fields.get(field); return value instanceof Integer ? (Integer) value : 0; }
    static Map<Integer, Object> nested(Map<Integer, Object> fields, int field) throws IOException { return decode((byte[]) fields.get(field)); }
    static byte[] outer(int field, byte[] body) { return join(number(1, 2), number(2, 200), bytes(field, body)); }
}
