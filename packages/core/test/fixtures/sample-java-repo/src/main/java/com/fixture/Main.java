package com.fixture;

import com.fixture.model.Item;
import com.fixture.server.Server;
import java.util.List;

/** Entry point of the fixture application. */
public class Main {
    // WHY: the wiring stays in main so the bootstrap order is visible
    public static void main(String[] args) {
        logStartup();
        Server server = new Server(8080);
        server.start();
        Item item = new Item("health", 1);
        List<Item> items = List.of(item);
        server.handle(items);
        System.out.println(server.addr());
    }

    private static void logStartup() {
        System.out.println("fixture up");
    }
}
