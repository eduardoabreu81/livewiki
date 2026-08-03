package server

import "fmt"

// Server listens on a TCP port and dispatches requests.
type Server struct {
	Port int
}

// Runner is the behavioral contract for anything startable.
type Runner interface {
	Start() error
}

// NewServer builds a Server bound to the given port.
func NewServer(port int) *Server {
	return &Server{Port: port}
}

// Addr renders the listen address for logging.
func (s *Server) Addr() string {
	return fmt.Sprintf(":%d", s.Port)
}

// Start begins the accept loop.
// HACK: the accept loop ignores transient errors until backoff lands
func (s Server) Start() error {
	return listen(s.Port)
}

func listen(port int) error {
	return nil
}
