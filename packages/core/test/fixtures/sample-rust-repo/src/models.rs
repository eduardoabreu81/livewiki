/// A single inbound request routed by the server.
pub struct Request {
    pub path: String,
}

impl Request {
    /// Builds a request for the given path.
    pub fn new(path: &str) -> Self {
        Request {
            path: path.to_string(),
        }
    }
}
