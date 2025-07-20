package rcon

import (
	"log"

	"github.com/gorcon/rcon"
)

func SendCommand(host string, port int, password, command string) {
	addr := fmt.Sprintf("%s:%d", host, port)
	conn, err := rcon.Dial(addr, password)
	if err != nil {
		log.Printf("[ERROR] RCON connection failed: %v", err)
		return
	}
	defer conn.Close()

	resp, err := conn.Execute(command)
	if err != nil {
		log.Printf("[ERROR] RCON command failed: %v", err)
		return
	}
	log.Printf("[RCON] %s", resp)
}