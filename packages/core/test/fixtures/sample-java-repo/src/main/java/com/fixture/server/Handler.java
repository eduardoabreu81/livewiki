package com.fixture.server;

import com.fixture.model.Item;
import java.util.List;

/**
 * Handler is the behavioral contract for item processors.
 */
public interface Handler {
    /**
     * Processes one batch of inbound items.
     */
    void handle(List<Item> items);
}
