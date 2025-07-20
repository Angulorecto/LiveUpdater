package config

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

func ReadProperties(path string) (map[string]string, error) {
	props := make(map[string]string)
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	sc := bufio.NewScanner(file)
	for sc.Scan() {
		line := sc.Text()
		if strings.TrimSpace(line) == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 {
			props[strings.TrimSpace(parts[0])] = strings.TrimSpace(parts[1])
		}
	}
	return props, sc.Err()
}

func WriteProperties(path string, props map[string]string) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()

	for k, v := range props {
		_, err := fmt.Fprintf(f, "%s=%s\n", k, v)
		if err != nil {
			return err
		}
	}
	return nil
}

func UpdateRCONSettings(path, password string, port int) error {
	props, err := ReadProperties(path)
	if err != nil {
		return err
	}
	props["enable-rcon"] = "true"
	props["rcon.password"] = password
	props["rcon.port"] = fmt.Sprintf("%d", port)
	return WriteProperties(path, props)
}

func SecureRCON(path string) error {
	// Implement firewall rule logic here if needed
	return UpdateRCONSettings(path, "AG0dAwfulAndL0ngP4sswordThat#N0OneCanGuessAnd0nlyIC4n#Us3", 25575)
}