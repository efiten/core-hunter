package main

import (
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/efiten/core-hunter/server/internal/config"
	"github.com/efiten/core-hunter/server/internal/ingest"
	"github.com/efiten/core-hunter/server/internal/store"
	"github.com/efiten/core-hunter/server/internal/version"
)

func main() {
	log.Printf("core-hunter ingestor version %s starting", version.Version)

	cfgPath := "config.json"
	if len(os.Args) > 1 {
		cfgPath = os.Args[1]
	}
	cfg, err := config.Load(cfgPath)
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	st, err := store.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("store: %v", err)
	}

	opts := mqtt.NewClientOptions().
		AddBroker(cfg.MQTTURL).
		SetUsername(cfg.MQTTUsername).
		SetPassword(cfg.MQTTPassword).
		SetClientID("core-hunter-ingestor").
		SetAutoReconnect(true).
		SetCleanSession(false)
	opts.SetConnectionLostHandler(func(_ mqtt.Client, err error) {
		log.Printf("mqtt connection lost: %v", err)
	})
	opts.SetOnConnectHandler(func(c mqtt.Client) {
		if tok := c.Subscribe(cfg.MQTTTopic, 1, func(_ mqtt.Client, m mqtt.Message) {
			if err := ingest.Handle(st, m.Topic(), m.Payload(), func() string {
				return time.Now().UTC().Format(time.RFC3339)
			}); err != nil {
				log.Printf("ingest error: %v", err)
			}
		}); tok.Wait() && tok.Error() != nil {
			log.Printf("subscribe error: %v", tok.Error())
		} else {
			log.Printf("subscribed to %s", cfg.MQTTTopic)
		}
	})

	client := mqtt.NewClient(opts)

	http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if client == nil || !client.IsConnected() {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"status":"mqtt disconnected","version":"` + version.Version + `"}`))
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok","version":"` + version.Version + `"}`))
	})

	go func() {
		if err := http.ListenAndServe(cfg.HTTPAddr, nil); err != nil {
			log.Printf("http server stopped: %v", err)
		}
	}()

	if t := client.Connect(); t.Wait() && t.Error() != nil {
		log.Fatalf("mqtt connect: %v", t.Error())
	}

	log.Printf("ingestor listening on %s, topic %s", cfg.HTTPAddr, cfg.MQTTTopic)

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh
	log.Printf("shutting down")
	client.Disconnect(250)
	_ = st.Close()
}
