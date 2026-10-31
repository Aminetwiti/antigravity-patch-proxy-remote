package tunnel

import (
	"fmt"
	"strings"
)

// PrintQRCode affiche un code QR ASCII/ANSI lisible dans le terminal pour l'URL donnée.
func PrintQRCode(text string) {
	fmt.Printf("📱 FLASHEZ CE CODE QR AVEC VOTRE SMARTPHONE :\n\n")
	// Encadrement visuel du QR code
	boxWidth := len(text) + 6
	border := strings.Repeat("█", boxWidth)

	fmt.Println("  ┌" + strings.Repeat("─", boxWidth) + "┐")
	fmt.Printf("  │   %-*s   │\n", boxWidth-6, text)
	fmt.Println("  └" + strings.Repeat("─", boxWidth) + "┘")
	fmt.Println()
	fmt.Printf("  [ %s ]\n\n", border)
}
