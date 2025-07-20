package ftp

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"strings"
	"time"

	ftpserver "github.com/fclairamb/ftpserverlib"
)

type FTPDriver struct{}

func (d *FTPDriver) Settings() (*ftpserver.Settings, error) {
	return &ftpserver.Settings{
		ListenAddr: ":2121",
	}, nil
}

func (d *FTPDriver) ClientConnected(cc ftpserver.ClientContext) (ftpserver.ClientDriver, error) {
	return &ClientDriver{}, nil
}

func (d *FTPDriver) ClientDisconnected(cc ftpserver.ClientContext) {}

type ClientDriver struct{}

func (cd *ClientDriver) AuthUser(cc ftpserver.ClientContext, user, pass string) (bool, error) {
	return user == "admin" && pass == "password", nil
}

func (cd *ClientDriver) ChangeDirectory(path string) error {
	return nil
}

func (cd *ClientDriver) MakeDirectory(path string) error {
	return os.MkdirAll(path, 0755)
}

func (cd *ClientDriver) ListFiles(path string) ([]os.FileInfo, error) {
	return os.ReadDir(path)
}

func (cd *ClientDriver) OpenFile(path string, flag int) (ftpserver.FileStream, error) {
	return os.OpenFile(path, flag, 0644)
}

func (cd *ClientDriver) DeleteFile(path string) error {
	return os.Remove(path)
}

func (cd *ClientDriver) DeleteDir(path string) error {
	return os.RemoveAll(path)
}

func (cd *ClientDriver) Rename(fromPath, toPath string) error {
	return os.Rename(fromPath, toPath)
}

func (cd *ClientDriver) Chmod(path string, mode os.FileMode) error {
	return os.Chmod(path, mode)
}

func (cd *ClientDriver) Chown(path string, uid, gid int) error {
	return nil // skip for Windows
}

func (cd *ClientDriver) Chtimes(path string, atime, mtime time.Time) error {
	return os.Chtimes(path, atime, mtime)
}

func (cd *ClientDriver) CanAllocate(size int) (bool, error) {
	return true, nil
}

func (cd *ClientDriver) UploadFile(path string, data io.Reader, appendData bool) (int64, error) {
	var f *os.File
	var err error
	if appendData {
		f, err = os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	} else {
		f, err = os.Create(path)
	}
	if err != nil {
		return 0, err
	}
	defer f.Close()

	n, err := io.Copy(f, data)
	if err != nil {
		return n, err
	}

	if strings.HasSuffix(path, ".jar") {
		fmt.Println("JAR uploaded:", path)
		runReloadCommand(path)
	}

	return n, nil
}

func runReloadCommand(path string) {
	fmt.Println("Triggering reload for:", path)

	cmd := exec.Command("screen", "-S", "minecraft", "-p", "0", "-X", "stuff", fmt.Sprintf("reload\n"))
	err := cmd.Run()
	if err != nil {
		log.Println("Error sending reload command:", err)
	}
}

func main() {
	driver := &FTPDriver{}
	server := ftpserver.NewFtpServer(driver)

	fmt.Println("🚀 FTP Server running on :2121")
	if err := server.ListenAndServe(); err != nil {
		log.Fatal("FTP server failed:", err)
	}
}
