package main

import (
	"fmt"
	"os"

	"sparkstudio/backend/internal/auth"
)

func main() {
	if len(os.Args) != 2 {
		panic("usage: hashpwd <password>")
	}
	hash, err := auth.HashPassword(os.Args[1])
	if err != nil {
		panic(err)
	}
	fmt.Print(hash)
}
