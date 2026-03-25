package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/shiena/ansicolor"
	log "github.com/sirupsen/logrus"

	nested "github.com/antonfisher/nested-logrus-formatter"
	_ "github.com/mattn/go-sqlite3"
	"github.com/spf13/viper"
)

var (
	hf    bool
	cf    string
	serve bool
	addr  string
)

func init() {
	flag.BoolVar(&hf, "h", false, "this help")
	flag.StringVar(&cf, "c", "conf.toml", "set config `file`")
	flag.BoolVar(&serve, "serve", true, "start web console server")
	flag.StringVar(&addr, "addr", "", "set http listen address")
	flag.Usage = usage

	log.SetFormatter(&nested.Formatter{
		HideKeys:        true,
		ShowFullLevel:   true,
		TimestampFormat: "2006-01-02 15:04:05.000",
	})
	log.SetOutput(ansicolor.NewAnsiColorWriter(os.Stdout))
	log.SetLevel(log.InfoLevel)
}

func usage() {
	fmt.Fprintf(os.Stderr, `tiler version: tiler/v0.2.0
Usage: tiler [-h] [-c filename] [-serve] [-addr :8080]
`)
	flag.PrintDefaults()
}

func initConf(cfgFile string) {
	if _, err := os.Stat(cfgFile); os.IsNotExist(err) {
		log.Warnf("config file(%s) not exist", cfgFile)
	}

	viper.SetConfigType("toml")
	viper.SetConfigFile(cfgFile)
	viper.AutomaticEnv()

	if err := viper.ReadInConfig(); err != nil {
		log.Warnf("read config file(%s) error, details: %s", viper.ConfigFileUsed(), err)
	}

	viper.SetDefault("app.version", "v0.2.0")
	viper.SetDefault("app.title", "MapCloud Tiler Console")
	viper.SetDefault("output.format", "file")
	viper.SetDefault("output.directory", "output")
	viper.SetDefault("task.workers", 4)
	viper.SetDefault("task.savepipe", 1)
	viper.SetDefault("task.timedelay", 0)
	viper.SetDefault("task.retrycount", 2)
	viper.SetDefault("task.retrydelay", 1000)
	viper.SetDefault("task.mergebuf", 128)
	viper.SetDefault("task.database", filepath.Join("output", "tasks.sqlite"))
	viper.SetDefault("server.addr", ":8080")
}

func runCLI() error {
	req, err := loadDefaultTaskRequest()
	if err != nil {
		return err
	}

	task, err := NewTaskFromRequest(req)
	if err != nil {
		return err
	}

	start := time.Now()
	if err := task.Run(); err != nil {
		return err
	}

	log.Printf("%.3fs finished...", time.Since(start).Seconds())
	return nil
}

func main() {
	flag.Parse()
	if hf {
		flag.Usage()
		return
	}

	if cf == "" {
		cf = "conf.toml"
	}
	initConf(cf)

	if addr == "" {
		addr = viper.GetString("server.addr")
	}

	if serve {
		if err := startServer(addr); err != nil {
			log.Fatal(err)
		}
		return
	}

	if err := runCLI(); err != nil {
		log.Fatal(err)
	}
}
