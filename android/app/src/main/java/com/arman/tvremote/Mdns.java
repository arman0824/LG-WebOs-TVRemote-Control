package com.arman.tvremote;

import java.io.*;
import java.nio.charset.StandardCharsets;

final class Mdns {
    static final String SERVICE = "_androidtvremote2._tcp.local";
    static byte[] query() throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] header = new byte[12]; header[5] = 1; out.write(header);
        for (String label : SERVICE.split("\\.")) { byte[] bytes = label.getBytes(StandardCharsets.US_ASCII); out.write(bytes.length); out.write(bytes); }
        out.write(new byte[] { 0, 0, 12, (byte) 128, 1 }); return out.toByteArray();
    }
    private static int word(byte[] data, int at) { return (data[at] & 255) * 256 + (data[at + 1] & 255); }
    private static String name(byte[] data, int[] cursor, int depth) throws IOException {
        if (depth > 20) throw new IOException("DNS pointer loop.");
        StringBuilder result = new StringBuilder();
        while (cursor[0] < data.length) {
            int size = data[cursor[0]++] & 255;
            if (size == 0) return result.toString();
            if (result.length() > 0) result.append('.');
            if ((size & 192) == 192) {
                int target = ((size & 63) << 8) | (data[cursor[0]++] & 255);
                result.append(name(data, new int[] { target }, depth + 1)); return result.toString();
            }
            if (size > 63 || cursor[0] + size > data.length) throw new IOException("Invalid DNS label.");
            result.append(new String(data, cursor[0], size, StandardCharsets.UTF_8)); cursor[0] += size;
        }
        throw new IOException("Truncated DNS name.");
    }
    static String response(byte[] data) {
        try {
            if (data.length < 12 || (data[2] & 128) == 0) return "";
            int questions = word(data, 4), records = word(data, 6) + word(data, 8) + word(data, 10);
            if (questions > 32 || records > 128) return "";
            int[] cursor = { 12 };
            for (int i = 0; i < questions; i++) { name(data, cursor, 0); cursor[0] += 4; }
            for (int i = 0; i < records; i++) {
                String owner = name(data, cursor, 0);
                int type = word(data, cursor[0]), length = word(data, cursor[0] + 8); cursor[0] += 10;
                if (cursor[0] + length > data.length) return "";
                String value = type == 12 && owner.equals(SERVICE) ? name(data, new int[] { cursor[0] }, 0) : owner;
                if ((type == 12 || type == 33) && value.endsWith("." + SERVICE)) return value.substring(0, value.length() - SERVICE.length() - 1);
                cursor[0] += length;
            }
        } catch (Exception ignored) { }
        return "";
    }
}
