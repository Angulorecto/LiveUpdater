package main

import (
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"LiveUpdaterGO/config"
	"LiveUpdaterGO/ftp"
)

func main() {
	// Paths
	pluginsDir := filepath.Clean("../../plugins")
	serverPropsPath := filepath.Clean("../../server.properties")

	// Ensure RCON is enabled
	err := config.SecureRCON(serverPropsPath)
	if err != nil {
		log.Fatalf("[ERROR] Securing RCON failed: %v", err)
	}

	// Update RCON settings
	rconPassword := "AG0dAwfulAndL0ngP4sswordThat#N0OneCanGuessAnd0nlyIC4n#Us3"
	err = config.UpdateRCONSettings(serverPropsPath, rconPassword, 25575)
	if err != nil {
		log.Fatalf("[ERROR] Updating RCON settings failed: %v", err)
	}

	// Start FTP server
	go func() {
		err := ftp.StartFTPTLSServer()
		if err != nil {
			log.Fatalf("[ERROR] FTP server failed: %v", err)
		}
	}()

	// Graceful shutdown
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	log.Println("[INFO] Shutdown signal received. Exiting.")
}
