package com.arman.lgremote;

import org.json.JSONObject;

interface TvClient {
    boolean connected();
    JSONObject command(String name, JSONObject payload) throws Exception;
    void checkStatus();
    void close();
}
