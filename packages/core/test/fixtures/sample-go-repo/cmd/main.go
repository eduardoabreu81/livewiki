package main

import (
	"fmt"

	"example.com/fixture/server"
)

// WHY: the entry point stays in main so the binary target is obvious
func main() {
	srv := server.NewServer(8080)
	fmt.Println(srv.Addr())
	if err := srv.Start(); err != nil {
		fmt.Println(err)
	}
}
