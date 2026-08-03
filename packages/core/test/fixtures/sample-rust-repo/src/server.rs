use crate::models::Request;

/// Server accepts inbound requests and dispatches them to handlers.
pub struct Server {
    port: u16,
}

/// Mode selects the server's concurrency strategy.
pub enum Mode {
    Fast,
    Slow,
}

/// Handler is the behavioral contract for request processors.
pub trait Handler {
    fn process(&self, request: &Request);
}

impl Server {
    /// Creates a server bound to the given port.
    pub fn new(port: u16) -> Self {
        Server { port }
    }

    /// Renders the listen address for logging.
    pub fn addr(&self) -> String {
        format!(":{}", self.port)
    }

    // HACK: the dispatch ignores backpressure until the queue lands
    pub fn handle(&self, request: Request) {
        dispatch(request);
    }
}

impl Handler for Server {
    fn process(&self, request: &Request) {
        dispatch_ref(request);
    }
}

fn dispatch(request: Request) {
    drop(request);
}

fn dispatch_ref(request: &Request) {
    drop(request);
}
