package com.fixture.model;

/**
 * A single inbound item routed by the server.
 */
public record Item(String name, int qty) {
    /** Renders the item for logging. */
    public String describe() {
        return name + " x" + qty;
    }
}
