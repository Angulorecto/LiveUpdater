package plugin

import (
	"archive/zip"
	"io"

	"gopkg.in/yaml.v2"
)

func GetPluginNameFromJar(jarPath string) (string, error) {
	r, err := zip.OpenReader(jarPath)
	if err != nil {
		return "", err
	}
	defer r.Close()

	for _, f := range r.File {
		if f.Name == "plugin.yml" {
			rc, err := f.Open()
			if err != nil {
				return "", err
			}
			defer rc.Close()

			data, err := io.ReadAll(rc)
			if err != nil {
				return "", err
			}

			var yml map[string]interface{}
			err = yaml.Unmarshal(data, &yml)
			if err != nil {
				return "", err
			}

			if name, ok := yml["name"].(string); ok {
				return name, nil
			}
		}
	}
	return "", nil
}
