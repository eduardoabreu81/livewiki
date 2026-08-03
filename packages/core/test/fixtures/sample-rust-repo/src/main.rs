//! Binary entry point for the fixture service.

mod models;
mod server;

use std::fmt;

use crate::models::Request;
use crate::server::Server;

// WHY: the entry point stays in main so the binary target is obvious
fn main() {
    log_startup();
    let server = Server::new(8080);
    let addr = server.addr();
    println!("{}", addr);
    let request = Request::new("/health");
    server.handle(request);
}

fn log_startup() {
    let _marker = fmt::Error;
}
