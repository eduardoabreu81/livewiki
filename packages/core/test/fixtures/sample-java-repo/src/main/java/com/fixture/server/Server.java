package com.fixture.server;

import com.fixture.model.Item;
import java.util.List;

/**
 * Server accepts inbound items and dispatches them to the handler.
 */
public class Server implements Handler {
    private final int port;

    /**
     * Creates a server bound to the given port.
     */
    public Server(int port) {
        this.port = port;
    }

    /** Starts the accept loop. */
    public void start() {
        listen(port);
    }

    /** Renders the listen address for logging. */
    public String addr() {
        return ":" + port;
    }

    @Override
    public void handle(List<Item> items) {
        // HACK: the dispatch ignores backpressure until the queue lands
        dispatch(items);
    }

    private void dispatch(List<Item> items) {
        for (Item item : items) {
            process(item);
        }
    }

    private static void listen(int port) {
        Mode mode = Mode.FAST;
        System.out.println("listening on " + port + " " + mode);
    }

    private static void process(Item item) {
        System.out.println(item.describe());
    }
}
